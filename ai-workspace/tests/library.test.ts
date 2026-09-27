import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completeHandoff } from "@/server/ai/handoff";
import { runChatTurn } from "@/server/ai/orchestrator";
import type { SessionUser } from "@/server/auth/session";
import { createConversation } from "@/server/conversations/service";
import { closeDb, db, initDb, schema } from "@/server/db/client";
import { saveKnowledge } from "@/server/files/knowledge";
import { listFiles } from "@/server/files/service";
import { createProject, upsertMember } from "@/server/projects/service";
import { normalizeSourceUrl, projectSources } from "@/server/sources/service";
import { monthlyUsage } from "@/server/usage/service";
import { parseVerdict } from "@/lib/verdict";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };

describe("project library: knowledge, sources, usage", () => {
  let user: SessionUser;
  let viewer: SessionUser;
  beforeAll(async () => {
    await initDb();
    const mk = async (email: string) => {
      const [u] = await db().insert(schema.users).values({ email, name: email, passwordHash: "x" }).returning();
      return { id: u!.id, email: u!.email, name: u!.name, role: u!.role } as SessionUser;
    };
    user = await mk("library@test.local");
    viewer = await mk("library-viewer@test.local");
  });
  afterAll(() => closeDb());

  /** One manual Perplexity turn where the user pastes `answer`. */
  async function manualTurn(projectId: string, conversationId: string, answer: string) {
    for await (const e of runChatTurn({ user, meta, projectId, conversationId, content: "Wat is AMLA?", modelId: "manual:perplexity" })) {
      if (e.type === "handoff") completeHandoff(e.handoff.handoffId, user.id, answer);
    }
  }

  it("normalizes source URLs", () => {
    expect(normalizeSourceUrl("https://amla.europa.eu/#top")).toBe("https://amla.europa.eu");
    expect(normalizeSourceUrl("https://eur-lex.europa.eu/x/")).toBe("https://eur-lex.europa.eu/x");
    expect(normalizeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeSourceUrl(42)).toBeNull();
  });

  it("builds a deduplicated source library and counts usage per tool", { timeout: 30_000 }, async () => {
    const project = await createProject(user, { name: "Bronnen", classification: "internal", piiRedaction: false }, meta);
    const a = await createConversation(user, project.id, "Eerste", meta);
    const b = await createConversation(user, project.id, "Tweede", meta);
    await manualTurn(project.id, a.id, "Zie [AMLA](https://amla.europa.eu) en https://eur-lex.europa.eu/eli/reg/2024/1624");
    await manualTurn(project.id, b.id, "Volgens https://amla.europa.eu/#mandaat is dat zo.");

    const sources = await projectSources(project.id);
    expect(sources.map((s) => [s.url, s.count])).toEqual([
      ["https://amla.europa.eu", 2],
      ["https://eur-lex.europa.eu/eli/reg/2024/1624", 1],
    ]);
    expect(sources[0]).toMatchObject({ title: "AMLA", domain: "amla.europa.eu", tools: ["Perplexity (handmatig)"] });
    expect(sources[0]!.conversations.map((c) => c.title).sort()).toEqual(["Eerste", "Tweede"]);

    const { usage } = await monthlyUsage(user.id);
    const perplexity = usage.find((u) => u.tool === "perplexity")!;
    expect(perplexity.questions).toBeGreaterThanOrEqual(2);
    expect(perplexity.estimated).toBe(true); // manual answers have no token counts
    expect(perplexity.outputTokens).toBeGreaterThan(0);
    expect(usage.find((u) => u.tool === "claude")!.questions).toBe(0);
  });

  it("saves an answer as project knowledge that later conversations include", { timeout: 30_000 }, async () => {
    const project = await createProject(user, { name: "Kennis", classification: "internal", piiRedaction: false }, meta);
    await upsertMember(user, project.id, viewer.email, "viewer", meta);
    await expect(saveKnowledge(viewer, project.id, { title: "x", content: "y" }, meta)).rejects.toMatchObject({ status: 403 });

    await saveKnowledge(user, project.id, { title: 'AMLA: "kern"/samenvatting', content: "AMLA start toezicht in 2028." }, meta);
    const [file] = await listFiles(project.id);
    expect(file).toMatchObject({ filename: "Kennis - AMLA kern samenvatting.md", includeInContext: true });

    const conv = await createConversation(user, project.id, "Nieuw gesprek", meta);
    for await (const _ of runChatTurn({ user, meta, projectId: project.id, conversationId: conv.id, content: "Wanneer start het toezicht?", modelId: "mock:echo" })) {
      // drain
    }
    const [inv] = await db().select().from(schema.modelInvocations).where(eq(schema.modelInvocations.conversationId, conv.id));
    expect(JSON.stringify(inv!.requestPayload)).toContain("AMLA start toezicht in 2028.");
  });

  it("reads the second-opinion verdict", () => {
    expect(parseVerdict("Punten…\n\nOORDEEL: AANPASSEN", "OORDEEL")).toBe("AANPASSEN");
    expect(parseVerdict("Geen oordeel", "OORDEEL")).toBeNull();
  });
});
