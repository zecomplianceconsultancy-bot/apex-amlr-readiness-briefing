import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mergeGenerators } from "@/server/ai/workflows/merge";
import { judgePrompt, parseVerdict, quote } from "@/server/ai/workflows/prompts";
import { listRunsForConversation, runCompare, runResearch, type RunEvent } from "@/server/ai/workflows/runs";
import { verifyAuditChain } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import { createConversation } from "@/server/conversations/service";
import { closeDb, db, initDb, schema } from "@/server/db/client";
import { createProject } from "@/server/projects/service";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };

describe("workflow prompt helpers", () => {
  it("parses verdict lines tolerant of markdown, taking the last valid one", () => {
    expect(parseVerdict("bla\n**OORDEEL:** aanpassen", "OORDEEL")).toBe("AANPASSEN");
    expect(parseVerdict("OORDEEL: AKKOORD of OORDEEL: ONBETROUWBAAR\n…\nOORDEEL: AKKOORD", "OORDEEL")).toBe("AKKOORD");
    expect(parseVerdict("OVEREENSTEMMING: laag", "OVEREENSTEMMING")).toBe("LAAG");
    expect(parseVerdict("geen oordeel", "OORDEEL")).toBeNull();
    expect(parseVerdict("OORDEEL: MISSCHIEN", "OORDEEL")).toBeNull();
  });

  it("quotes long step output with an explicit truncation note", () => {
    expect(quote("abc", 10)).toBe("abc");
    expect(quote("x".repeat(20), 10)).toContain("ingekort: 10 tekens weggelaten");
    expect(judgePrompt("v", [{ label: 'A "1"', text: "t" }])).toContain(`<antwoord model="A '1'">`);
  });

  it("merges concurrent generators and returns their results in order", async () => {
    const gen = async function* (name: string, delays: number[]) {
      for (const d of delays) {
        await new Promise((r) => setTimeout(r, d));
        yield `${name}${d}`;
      }
      return name;
    };
    const seen: string[] = [];
    const merged = mergeGenerators([gen("a", [30, 30]), gen("b", [10])]);
    let r = await merged.next();
    while (!r.done) {
      seen.push(r.value);
      r = await merged.next();
    }
    expect(seen[0]).toBe("b10"); // interleaved, not sequential
    expect(r.value).toEqual(["a", "b"]);
  });
});

describe("multi-model runs (mock engines)", () => {
  let user: SessionUser;

  beforeAll(async () => {
    await initDb();
    const [u] = await db().insert(schema.users).values({ email: "wf@test.local", name: "wf", passwordHash: "x" }).returning();
    user = { id: u!.id, email: u!.email, name: u!.name, role: u!.role };
  });
  afterAll(async () => {
    expect((await verifyAuditChain()).ok).toBe(true);
    await closeDb();
  });

  async function setup(classification: "internal" | "restricted" = "internal") {
    const project = await createProject(user, { name: "WF", classification, piiRedaction: true }, meta);
    const conv = await createConversation(user, project.id, "Nieuw gesprek", meta);
    return { project, conv, input: { user, meta, projectId: project.id, conversationId: conv.id } };
  }
  async function collect(gen: AsyncGenerator<RunEvent>) {
    const events: RunEvent[] = [];
    for await (const e of gen) events.push(e);
    return events;
  }

  it("compare: answers in parallel, judge rates agreement, message holds the synthesis", { timeout: 60_000 }, async () => {
    const { conv, input } = await setup();
    const events = await collect(runCompare({ ...input, question: "Wat is CDD?" }, { modelIds: ["mock:echo", "mock:critic"], judgeModelId: "mock:critic" }));
    const run = events.find((e) => e.type === "run")!;
    expect(run.type === "run" && run.steps.map((s) => s.role)).toEqual(["answer", "answer", "judge"]);
    const done = events.filter((e) => e.type === "step-done");
    expect(done.map((d) => d.type === "step-done" && d.status)).toEqual(["complete", "complete", "complete"]);
    const judge = done.at(-1)!;
    expect(judge.type === "step-done" && judge.verdict).toBe("LAAG");
    const end = events.at(-1)!;
    expect(end).toMatchObject({ type: "done", status: "complete" });

    const msgs = await db().select().from(schema.messages).where(eq(schema.messages.conversationId, conv.id));
    const assistant = msgs.find((m) => m.role === "assistant")!;
    expect(assistant.runId).toBeTruthy();
    expect(assistant.status).toBe("complete");
    expect(assistant.content).toContain("mock-critic-1"); // judge output is the message
    const invs = await db().select().from(schema.modelInvocations).where(eq(schema.modelInvocations.conversationId, conv.id));
    expect(invs.map((i) => i.purpose).sort()).toEqual(["compare:answer", "compare:answer", "compare:judge"]);

    const runs = await listRunsForConversation(conv.id);
    const saved = Object.values(runs)[0]!;
    expect(saved.kind).toBe("compare");
    expect(saved.steps).toHaveLength(3);
  });

  it("research: research → draft → review → fact check → final, with verdicts", { timeout: 60_000 }, async () => {
    const { conv, input } = await setup();
    const events = await collect(
      runResearch(
        { ...input, question: "Wat verandert er onder AMLR?" },
        { research: "mock:echo", draft: "mock:echo", review: "mock:critic", factcheck: "mock:critic", final: "mock:echo" },
      ),
    );
    const done = events.filter((e) => e.type === "step-done");
    expect(done.map((d) => d.type === "step-done" && d.status)).toEqual(["complete", "complete", "complete", "complete", "complete"]);
    expect(done[2]!.type === "step-done" && done[2]!.verdict).toBe("AANPASSEN");
    expect(done[3]!.type === "step-done" && done[3]!.verdict).toBe("ONZEKER");
    const invs = await db().select().from(schema.modelInvocations).where(eq(schema.modelInvocations.conversationId, conv.id));
    expect(invs.map((i) => i.purpose)).toEqual(
      expect.arrayContaining(["research:research", "research:draft", "research:review", "research:factcheck", "research:final"]),
    );
    const final = invs.find((i) => i.purpose === "research:final")!;
    expect(JSON.stringify(final.requestPayload)).toContain("<feitencheck>");
    // Each step received the previous step's output.
    const review = invs.find((i) => i.purpose === "research:review")!;
    expect(JSON.stringify(review.requestPayload)).toContain("<concept>");
  });

  it("compare: a step blocked by the data policy fails alone; judge is skipped", { timeout: 60_000 }, async () => {
    const { input } = await setup("restricted");
    const events = await collect(
      runCompare({ ...input, question: "x" }, { modelIds: ["mock:echo", "browser:chatgpt"], judgeModelId: "mock:critic" }),
    );
    const done = events.filter((e) => e.type === "step-done");
    const byStatus = Object.fromEntries(done.map((d) => (d.type === "step-done" ? [d.status, d.error] : ["", ""])));
    expect(byStatus.complete).toBeNull();
    expect(byStatus.error).toContain("dit model mag alleen gegevens tot en met");
    expect(byStatus.skipped).toContain("Te weinig geslaagde");
    expect(events.at(-1)).toMatchObject({ type: "done", status: "complete" });
  });

  it("research with only research + draft (minimal preset): the draft is the answer", { timeout: 60_000 }, async () => {
    const { conv, input } = await setup();
    const events = await collect(runResearch({ ...input, question: "Kort?" }, { research: "mock:echo", draft: "mock:critic" }));
    const run = events.find((e) => e.type === "run")!;
    expect(run.type === "run" && run.steps.map((s) => s.role)).toEqual(["research", "draft"]);
    const end = events.at(-1)!;
    expect(end).toMatchObject({ type: "done", status: "complete", content: expect.stringContaining("mock-critic-1") });
    const [msg] = await db().select().from(schema.messages).where(eq(schema.messages.conversationId, conv.id)).orderBy(schema.messages.createdAt).offset(1);
    expect(msg!.status).toBe("complete");
  });

  it("marks the run cancelled when the client disconnects", { timeout: 60_000 }, async () => {
    const { conv, input } = await setup();
    const ac = new AbortController();
    const gen = runResearch({ ...input, question: "lang", signal: ac.signal }, { research: "mock:echo", draft: "mock:echo", review: "mock:critic", final: "mock:echo" });
    for await (const e of gen) if (e.type === "step-delta") ac.abort();
    const [run] = await db().select().from(schema.runs).where(eq(schema.runs.conversationId, conv.id));
    expect(run!.status).toBe("cancelled");
    const steps = await db().select().from(schema.runSteps).where(eq(schema.runSteps.runId, run!.id));
    expect(steps.map((s) => s.status).sort()).toEqual(["cancelled", "skipped", "skipped", "skipped"]);
  });
});
