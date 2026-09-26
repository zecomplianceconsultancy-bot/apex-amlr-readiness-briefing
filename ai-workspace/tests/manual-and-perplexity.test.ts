import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completeHandoff } from "@/server/ai/handoff";
import { runChatTurn, type ChatTurnEvent } from "@/server/ai/orchestrator";
import { extractCitations } from "@/server/ai/providers/manual";
import { PerplexityProvider, sourcesFrom } from "@/server/ai/providers/perplexity";
import type { ProviderEvent } from "@/server/ai/types";
import type { SessionUser } from "@/server/auth/session";
import { resetEnvCache } from "@/server/config/env";
import { createConversation } from "@/server/conversations/service";
import { closeDb, db, initDb, schema } from "@/server/db/client";
import { createProject } from "@/server/projects/service";
import { bestFor, suggestResearchTeam } from "@/lib/strengths";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };

describe("manual bridge", () => {
  let user: SessionUser;
  let other: SessionUser;
  beforeAll(async () => {
    await initDb();
    const mk = async (email: string) => {
      const [u] = await db().insert(schema.users).values({ email, name: email, passwordHash: "x" }).returning();
      return { id: u!.id, email: u!.email, name: u!.name, role: u!.role } as SessionUser;
    };
    user = await mk("manual@test.local");
    other = await mk("other@test.local");
  });
  afterAll(() => closeDb());

  it("gives web tools only the project's own context", async () => {
    const { webContext } = await import("@/server/ai/providers/browser");
    expect(webContext("Generic rules\nProject: x")).toBeUndefined();
    const ctx = webContext('Generic\n<project_instructions version="2">\nWees kort\n</project_instructions>\n<project_documents>\n<document name="a">A</document>\n</project_documents>');
    expect(ctx).toContain("Wees kort");
    expect(ctx).toContain('<document name="a">A</document>');
    expect(ctx).not.toContain("Generic");
  });

  it("extracts sources from pasted text (plain and markdown links, deduplicated)", () => {
    expect(extractCitations("Zie https://eur-lex.europa.eu/x. En [AMLA](https://amla.europa.eu) en https://eur-lex.europa.eu/x")).toEqual([
      { url: "https://eur-lex.europa.eu/x", title: undefined },
      { url: "https://amla.europa.eu", title: "AMLA" },
    ]);
  });

  it("hands the step to the user and records the pasted answer with its sources", { timeout: 30_000 }, async () => {
    const project = await createProject(user, { name: "Manual", classification: "internal", piiRedaction: true }, meta);
    const conv = await createConversation(user, project.id, "Nieuw gesprek", meta);
    const events: ChatTurnEvent[] = [];
    for await (const e of runChatTurn({ user, meta, projectId: project.id, conversationId: conv.id, content: "Mail jan@x.nl: wat is AMLA?", modelId: "manual:perplexity" })) {
      events.push(e);
      if (e.type === "handoff") {
        expect(e.handoff.prompt).toContain("[EMAIL_1]"); // masked before it is shown to be pasted anywhere
        expect(e.handoff.prompt).not.toContain("jan@x.nl");
        expect(e.handoff.openUrl).toMatch(/^https:\/\/www\.perplexity\.ai\/search\?q=/);
        expect(e.handoff.prompt).not.toContain("You are the AI assistant"); // no generic instructions for web tools
        expect(e.handoff.prefilled).toBe(true);
        expect(completeHandoff(e.handoff.handoffId, other.id, "nope")).toBe(false); // someone else cannot answer
        expect(completeHandoff(e.handoff.handoffId, user.id, "AMLA is de EU-antiwitwasautoriteit. Bron: https://amla.europa.eu")).toBe(true);
      }
    }
    const done = events.find((e) => e.type === "done");
    expect(done).toMatchObject({ type: "done", modelReported: "perplexity-handmatig", citations: [{ url: "https://amla.europa.eu" }] });
    const [inv] = await db().select().from(schema.modelInvocations).where(eq(schema.modelInvocations.conversationId, conv.id));
    expect(inv).toMatchObject({ status: "success", provider: "manual", responseText: expect.stringContaining("AMLA") });
  });

  it("skipping the manual step cancels it cleanly", { timeout: 30_000 }, async () => {
    const project = await createProject(user, { name: "Skip", classification: "internal", piiRedaction: false }, meta);
    const conv = await createConversation(user, project.id, "Nieuw gesprek", meta);
    const { cancelHandoff } = await import("@/server/ai/handoff");
    const run = async () => {
      for await (const e of runChatTurn({ user, meta, projectId: project.id, conversationId: conv.id, content: "x", modelId: "manual:gemini" })) {
        if (e.type === "handoff") cancelHandoff(e.handoff.handoffId, user.id);
      }
    };
    await expect(run()).rejects.toMatchObject({ code: "provider_cancelled" });
  });
});

describe("Perplexity API adapter", () => {
  const sse = (chunks: unknown[]) =>
    new Response(new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(ch)}\n\n`));
        c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        c.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });

  it("reads sources from search_results or citations", () => {
    expect(sourcesFrom({ search_results: [{ title: "T", url: "https://a.b" }, { nope: 1 }] })).toEqual([{ url: "https://a.b", title: "T" }]);
    expect(sourcesFrom({ citations: ["https://c.d", 3] })).toEqual([{ url: "https://c.d" }]);
    expect(sourcesFrom({})).toEqual([]);
  });

  it("streams text and returns sources, model and usage", async () => {
    process.env.PERPLEXITY_API_KEY = "pplx-test";
    resetEnvCache();
    let requested: { url: string; body: Record<string, unknown> } | undefined;
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requested = { url: String(url), body: JSON.parse(String(init?.body)) };
      return sse([
        { id: "r1", model: "sonar-pro", choices: [{ delta: { content: "AMLA " } }] },
        { id: "r1", model: "sonar-pro", choices: [{ delta: { content: "bestaat." }, finish_reason: "stop" }], search_results: [{ title: "AMLA", url: "https://amla.europa.eu" }], usage: { prompt_tokens: 12, completion_tokens: 3 } },
      ]);
    }) as typeof fetch;
    try {
      const p = new PerplexityProvider(fakeFetch);
      expect(p.isConfigured()).toBe(true);
      const events: ProviderEvent[] = [];
      for await (const e of p.streamChat({ providerModel: "sonar-pro", system: "S", messages: [{ role: "user", content: "Wat is AMLA?" }], maxOutputTokens: 100 })) events.push(e);
      expect(requested!.url).toBe("https://api.perplexity.ai/chat/completions");
      expect(requested!.body).toMatchObject({ model: "sonar-pro", stream: true, messages: [{ role: "system", content: "S" }, { role: "user", content: "Wat is AMLA?" }] });
      expect(events.filter((e) => e.type === "text").map((e) => e.type === "text" && e.text).join("")).toBe("AMLA bestaat.");
      expect(events.at(-1)).toMatchObject({
        type: "done",
        result: { text: "AMLA bestaat.", modelReported: "sonar-pro", finishReason: "stop", usage: { inputTokens: 12, outputTokens: 3 }, citations: [{ url: "https://amla.europa.eu", title: "AMLA" }] },
      });
    } finally {
      process.env.PERPLEXITY_API_KEY = "";
      resetEnvCache();
    }
  });
});

describe("choosing between browser, manual and API routes", () => {
  const m = (id: string, tags: string[], available = true) => ({ id, tags, available });
  it("falls back to the manual route when the automated browser tool is blocked, and prefers the API over manual", () => {
    const blocked = [
      m("browser:perplexity", ["sources", "web-research"], false),
      m("manual:perplexity", ["sources", "web-research", "manual"]),
      m("browser:chatgpt", ["structure", "writing", "reasoning"]),
      m("browser:claude", ["critical-review", "reasoning"]),
    ];
    expect(suggestResearchTeam(blocked)!.research).toBe("manual:perplexity");
    expect(bestFor("research", [...blocked, m("perplexity:sonar-pro", ["sources", "web-research"])])).toBe("perplexity:sonar-pro");
  });
});
