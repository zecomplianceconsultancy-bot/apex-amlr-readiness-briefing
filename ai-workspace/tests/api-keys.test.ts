import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listModelsFor } from "@/server/ai/catalog";
import { runChatTurn } from "@/server/ai/orchestrator";
import { getProvider } from "@/server/ai/providers";
import type { SessionUser } from "@/server/auth/session";
import { resetEnvCache } from "@/server/config/env";
import { createConversation } from "@/server/conversations/service";
import { closeDb, db, initDb, schema } from "@/server/db/client";
import { createProject } from "@/server/projects/service";
import { apiKey, apiKeyStatus, loadApiSettings, monthlyBudget, setApiKey, setMonthlyBudget } from "@/server/settings/api-keys";
import { testApiKey } from "@/server/settings/api-test";
import { apiSpendThisMonth } from "@/server/usage/api-spend";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const KEY = "sk-ant-api03-test-0123456789abcdefWXYZ";

describe("API connections", () => {
  let admin: SessionUser;
  beforeAll(async () => {
    await initDb();
    await loadApiSettings();
    const [u] = await db().insert(schema.users).values({ email: "api@test.local", name: "api", passwordHash: "x", role: "admin" }).returning();
    admin = { id: u!.id, email: u!.email, name: u!.name, role: "admin" };
  });
  afterAll(async () => {
    await setApiKey(admin, "anthropic", null, meta);
    await closeDb();
  });

  it("stores a key encrypted, shows only the last 4 characters and restores it after a restart", async () => {
    expect(getProvider("anthropic")!.isConfigured()).toBe(false);
    await expect(setApiKey({ ...admin, role: "member" }, "anthropic", KEY, meta)).rejects.toMatchObject({ status: 403 });
    await expect(setApiKey(admin, "anthropic", "pplx-verkeerde-sleutel-1234567890", meta)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("sk-ant-") });

    await setApiKey(admin, "anthropic", `  ${KEY} `, meta);
    expect(apiKeyStatus("anthropic")).toEqual({ connected: true, source: "app", last4: "WXYZ" });
    expect(getProvider("anthropic")!.isConfigured()).toBe(true);

    const [row] = await db().select().from(schema.appSettings).where(eq(schema.appSettings.key, "apikey.anthropic"));
    expect(JSON.stringify(row!.value)).not.toContain("0123456789abcdef"); // encrypted at rest
    const audits = await db().select().from(schema.auditEvents).where(eq(schema.auditEvents.action, "settings.api_key"));
    expect(JSON.stringify(audits.map((a) => a.details))).not.toContain("0123456789abcdef");

    (globalThis as { __aiwApi?: unknown }).__aiwApi = undefined; // simulate a restart
    expect(apiKey("anthropic")).toBeUndefined();
    await loadApiSettings();
    expect(apiKey("anthropic")).toBe(KEY);
  });

  it("stops paid API calls at the monthly budget", { timeout: 30_000 }, async () => {
    expect(monthlyBudget("anthropic")).toBe(20); // safe default
    const project = await createProject(admin, { name: "Budget", classification: "internal", piiRedaction: false }, meta);
    const conv = await createConversation(admin, project.id, "Nieuw gesprek", meta);
    // Pretend earlier Claude calls used ~ $0.03 this month.
    await db().insert(schema.modelInvocations).values({
      projectId: project.id, conversationId: conv.id, userId: admin.id, purpose: "chat", provider: "anthropic",
      modelId: "anthropic:claude-sonnet-5", modelRequested: "claude-sonnet-5", routing: {}, params: {}, requestPayload: {},
      requestHash: "x", contextRefs: {}, policy: {}, status: "success", inputTokens: 5_000, outputTokens: 2_000,
    });
    expect(await apiSpendThisMonth("anthropic")).toBeCloseTo((5_000 * 2 + 2_000 * 10) / 1_000_000, 6);

    await setMonthlyBudget(admin, "anthropic", 0.02, meta);
    const run = async () => {
      for await (const _ of runChatTurn({ user: admin, meta, projectId: project.id, conversationId: conv.id, content: "x", modelId: "anthropic:claude-sonnet-5" })) {
        // drain
      }
    };
    await expect(run()).rejects.toMatchObject({ status: 402, message: expect.stringContaining("Maandbudget") });
    const sonnet = listModelsFor("internal").find((m) => m.model.id === "anthropic:claude-sonnet-5")!;
    expect(sonnet).toMatchObject({ available: false, reason: expect.stringContaining("maandbudget") });
    await setMonthlyBudget(admin, "anthropic", 20, meta);
  });

  it("tests a key and explains the outcome in plain language", async () => {
    const reply = (status: number, body = "") => (async () => new Response(body, { status })) as unknown as typeof fetch;
    expect(await testApiKey("anthropic", reply(200))).toMatchObject({ ok: true });
    expect(await testApiKey("anthropic", reply(401))).toMatchObject({ ok: false, message: expect.stringContaining("weigert deze sleutel") });
    expect(await testApiKey("anthropic", reply(400, '{"error":{"message":"Your credit balance is too low"}}'))).toMatchObject({ ok: false, message: expect.stringContaining("tegoed") });
    expect(await testApiKey("perplexity", reply(200))).toMatchObject({ ok: false, message: expect.stringContaining("Nog geen sleutel") });
  });

  it("offers no browser engines when browser control is off (the default)", () => {
    process.env.ENABLE_BROWSER_PROVIDER = "false";
    resetEnvCache();
    try {
      const ids = listModelsFor("internal").map((m) => m.model.id);
      expect(ids.some((id) => id.startsWith("browser:"))).toBe(false);
      expect(ids).toContain("manual:claude");
    } finally {
      process.env.ENABLE_BROWSER_PROVIDER = "true";
      resetEnvCache();
    }
  });
});
