/**
 * End-to-end tests of the service layer against a real PostgreSQL database, using the
 * offline mock provider. Requires the test database (see tests/setup.ts).
 */
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runChatTurn, type ChatTurnEvent } from "@/server/ai/orchestrator";
import { PolicyBlockedError } from "@/server/ai/gateway";
import { verifyAuditChain } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import { env, resetEnvCache } from "@/server/config/env";
import { createConversation } from "@/server/conversations/service";
import { closeDb, db, initDb, schema } from "@/server/db/client";
import { downloadFile, uploadFile } from "@/server/files/service";
import { HttpError } from "@/server/http/errors";
import { createProject, saveContext, upsertMember } from "@/server/projects/service";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
let owner: SessionUser;
let outsider: SessionUser;

async function makeUser(email: string): Promise<SessionUser> {
  const [u] = await db().insert(schema.users).values({ email, name: email.split("@")[0]!, passwordHash: "x" }).returning();
  return { id: u!.id, email: u!.email, name: u!.name, role: u!.role };
}

async function collect(gen: AsyncGenerator<ChatTurnEvent>) {
  const events: ChatTurnEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

beforeAll(async () => {
  if (process.env.DATABASE_URL) {
    // Server mode: start from an empty schema.
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
    await pool.end();
  }
  await initDb();
  owner = await makeUser("owner@test.local");
  outsider = await makeUser("outsider@test.local");
});

afterAll(async () => {
  const result = await verifyAuditChain();
  expect(result.ok).toBe(true);
  await closeDb();
});

describe("chat turn through orchestrator → gateway → mock provider", () => {
  it("streams an answer, masks PII, and records full provenance", async () => {
    const project = await createProject(owner, { name: "KYC test", classification: "confidential", piiRedaction: true }, meta);
    const ctx = await saveContext(owner, project.id, "Antwoord altijd beknopt.", meta);
    const file = await uploadFile(owner, project.id, new File(["Klant: piet@example.com, IBAN NL91ABNA0417164300"], "dossier.txt"), meta);
    const conv = await createConversation(owner, project.id, "Nieuw gesprek", meta);

    const events = await collect(
      runChatTurn({ user: owner, meta, projectId: project.id, conversationId: conv.id, content: "Mail piet@example.com over zijn dossier", modelId: "mock:echo" }),
    );

    const metaEv = events.find((e) => e.type === "meta")!;
    const done = events.find((e) => e.type === "done")!;
    expect(metaEv).toMatchObject({ model: { id: "mock:echo" }, routing: { strategy: "manual" } });
    expect(metaEv.type === "meta" && metaEv.redactions).toBeGreaterThanOrEqual(3);
    expect(done).toMatchObject({ finishReason: "stop", modelReported: "mock-echo-1" });

    const text = events.map((e) => (e.type === "delta" ? e.text : "")).join("");
    expect(text).toContain("[EMAIL_1]");
    expect(text).not.toContain("piet@example.com");

    const [inv] = await db().select().from(schema.modelInvocations).where(eq(schema.modelInvocations.conversationId, conv.id));
    expect(inv).toMatchObject({ status: "success", provider: "mock", modelReported: "mock-echo-1", purpose: "chat" });
    expect(JSON.stringify(inv!.requestPayload)).not.toContain("piet@example.com");
    expect(JSON.stringify(inv!.requestPayload)).not.toContain("NL91ABNA0417164300");
    expect(inv!.contextRefs).toMatchObject({
      projectContext: { id: ctx.id, version: 1 },
      files: [{ id: file.id, filename: "dossier.txt", truncated: false }],
    });
    expect(inv!.requestHash).toMatch(/^[0-9a-f]{64}$/);

    const msgs = await db().select().from(schema.messages).where(eq(schema.messages.conversationId, conv.id));
    expect(msgs.map((m) => [m.role, m.status])).toEqual([
      ["user", "complete"],
      ["assistant", "complete"],
    ]);
    // Title derived from the first message.
    const [c] = await db().select().from(schema.conversations).where(eq(schema.conversations.id, conv.id));
    expect(c!.title).toBe("Mail piet@example.com over zijn dossier");

    const audit = await db().select().from(schema.auditEvents).where(eq(schema.auditEvents.projectId, project.id));
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["project.create", "project.context.update", "file.upload", "conversation.create", "ai.invocation.completed"]),
    );
  });

  it("stores files encrypted and returns identical bytes", async () => {
    const project = await createProject(owner, { name: "Files", classification: "internal", piiRedaction: false }, meta);
    const f = await uploadFile(owner, project.id, new File(["hallo wereld"], "a.md"), meta);
    const [row] = await db().select().from(schema.files).where(eq(schema.files.id, f.id));
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(`${env().STORAGE_DIR}/${row!.storageKey}.bin`);
    expect(raw.toString()).not.toContain("hallo");
    const dl = await downloadFile(owner, project.id, f.id, meta);
    expect(dl.data.toString()).toBe("hallo wereld");
    await expect(uploadFile(owner, project.id, new File(["MZ..."], "evil.exe"), meta)).rejects.toThrow(/niet toegestaan/);
    await expect(uploadFile(owner, project.id, new File(["not a pdf"], "fake.pdf"), meta)).rejects.toThrow(/niet toegestaan/);
  });

  it("blocks and audits a call when the project is more sensitive than the model's clearance", async () => {
    process.env.OPENAI_API_KEY = "sk-test-not-used";
    resetEnvCache();
    try {
      const project = await createProject(owner, { name: "Strikt", classification: "restricted", piiRedaction: true }, meta);
      const conv = await createConversation(owner, project.id, "Nieuw gesprek", meta);
      await expect(
        collect(runChatTurn({ user: owner, meta, projectId: project.id, conversationId: conv.id, content: "hoi", modelId: "openai:gpt-5.5" })),
      ).rejects.toBeInstanceOf(PolicyBlockedError);
      const [inv] = await db().select().from(schema.modelInvocations).where(eq(schema.modelInvocations.projectId, project.id));
      expect(inv).toMatchObject({ status: "blocked", errorCode: "policy_blocked", requestPayload: { withheld: true } });
      const [ev] = await db().select().from(schema.auditEvents).where(eq(schema.auditEvents.entityId, inv!.id));
      expect(ev!.action).toBe("ai.invocation.blocked");
    } finally {
      process.env.OPENAI_API_KEY = "";
      resetEnvCache();
    }
  });

  it("records a cancelled invocation when the client aborts mid-stream", async () => {
    const project = await createProject(owner, { name: "Cancel", classification: "internal", piiRedaction: false }, meta);
    const conv = await createConversation(owner, project.id, "Nieuw gesprek", meta);
    const ac = new AbortController();
    const gen = runChatTurn({ user: owner, meta, projectId: project.id, conversationId: conv.id, content: "vertel iets lang", modelId: "mock:echo", signal: ac.signal });
    await expect(
      (async () => {
        for await (const e of gen) if (e.type === "delta") ac.abort();
      })(),
    ).rejects.toMatchObject({ code: "provider_cancelled" });
    const [inv] = await db().select().from(schema.modelInvocations).where(eq(schema.modelInvocations.conversationId, conv.id));
    expect(inv!.status).toBe("cancelled");
    const [assistant] = await db().select().from(schema.messages).where(eq(schema.messages.invocationId, inv!.id));
    expect(assistant!.status).toBe("cancelled");
  });
});

describe("access control", () => {
  it("hides projects from non-members and enforces roles", async () => {
    const project = await createProject(owner, { name: "Geheim", classification: "internal", piiRedaction: true }, meta);
    const conv = await createConversation(owner, project.id, "Nieuw gesprek", meta);
    const attempt = () => collect(runChatTurn({ user: outsider, meta, projectId: project.id, conversationId: conv.id, content: "hoi", modelId: "mock:echo" }));
    await expect(attempt()).rejects.toMatchObject({ status: 404 });

    await upsertMember(owner, project.id, outsider.email, "viewer", meta);
    await expect(attempt()).rejects.toMatchObject({ status: 403 });

    await upsertMember(owner, project.id, outsider.email, "editor", meta);
    const events = await attempt();
    expect(events.at(-1)?.type).toBe("done");
  });

  it("rejects a conversation id from another project", async () => {
    const a = await createProject(owner, { name: "A", classification: "internal", piiRedaction: true }, meta);
    const b = await createProject(owner, { name: "B", classification: "internal", piiRedaction: true }, meta);
    const convB = await createConversation(owner, b.id, "Nieuw gesprek", meta);
    await expect(collect(runChatTurn({ user: owner, meta, projectId: a.id, conversationId: convB.id, content: "x" }))).rejects.toBeInstanceOf(HttpError);
  });
});

describe("audit trail", () => {
  it("is append-only at the database level", async () => {
    // Drizzle wraps the driver error; the trigger's message is on `cause`.
    const dbError = (q: Promise<unknown>) => q.then(() => "no error", (e: Error & { cause?: Error }) => e.cause?.message ?? e.message);
    expect(await dbError(db().execute(sql`UPDATE audit_events SET action = 'tampered'`))).toMatch(/append-only/);
    expect(await dbError(db().execute(sql`DELETE FROM audit_events`))).toMatch(/append-only/);
    expect(await dbError(db().execute(sql`TRUNCATE audit_events`))).toMatch(/append-only/);
  });
});
