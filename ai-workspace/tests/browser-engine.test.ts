import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runOnPage } from "@/server/ai/browser/engine";
import { closeBrowser } from "@/server/ai/browser/session";
import { registerSite, type SiteProfile } from "@/server/ai/browser/sites";
import { BrowserProvider, flattenPrompt } from "@/server/ai/providers/browser";
import { resolvePending } from "@/server/ai/pending";
import { ProviderError, type ProviderEvent } from "@/server/ai/types";
import type { SessionUser } from "@/server/auth/session";
import { closeDb, db, initDb, schema } from "@/server/db/client";
import { browserControlMode, loadPermissions, setBrowserControlMode } from "@/server/settings/permissions";
import { fixtureSelectors, startFixtureSite } from "./fixtures/chat-site";

const nonSpace = (s: string) => s.replace(/\s+/g, "").length;

let site: Awaited<ReturnType<typeof startFixtureSite>>;
let browser: Browser;
let page: Page;

const profile = (path = "/", id = "fixture"): SiteProfile => ({ id, label: "Fixture", newChatUrl: `${site.baseUrl}${path}`, ...fixtureSelectors });

async function collect(gen: AsyncGenerator<ProviderEvent>) {
  const deltas: string[] = [];
  for await (const e of gen) {
    if (e.type === "text") deltas.push(e.text);
    else if (e.type === "done") return { deltas, result: e.result };
  }
  throw new Error("no done event");
}

beforeAll(async () => {
  site = await startFixtureSite();
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
  await closeBrowser();
  await site?.close();
});

describe("browser engine", () => {
  it("types the prompt, streams the answer and collects deduplicated sources", { timeout: 20_000 }, async () => {
    const { deltas, result } = await collect(runOnPage(page, profile(), "Wat is de UBO-drempel?", { answerTimeoutMs: 20_000 }));
    expect(deltas.length).toBeGreaterThan(3); // really streamed, not one blob
    expect(result.text).toContain("Antwoord op: Wat is de UBO-drempel?");
    expect(result.text).toContain(`Ik ontving ${nonSpace("Wat is de UBO-drempel?")} tekens`);
    expect(result.citations).toEqual([
      { url: "https://example.org/bron-1", title: "Bron 1" },
      { url: "https://example.org/bron-2", title: "Bron 2" },
    ]);
    expect(result.modelReported).toBe("fixture-web");
    expect(result.providerRequestId).toMatch(/\/thread\/\d+$/); // link to the tool's own thread
  });

  it("handles contenteditable inputs and multi-line prompts", { timeout: 20_000 }, async () => {
    const prompt = "<instructions>\nWees kort.\n</instructions>\n\nNoem drie AML-risico's";
    const { result } = await collect(runOnPage(page, profile("/ce"), prompt, { answerTimeoutMs: 20_000 }));
    expect(result.text).toContain("Antwoord op: Noem drie AML-risico's");
    expect(result.text).toContain(`Ik ontving ${nonSpace(prompt)} tekens`);
  });

  it("reports a login problem when the input is missing", async () => {
    await expect(collect(runOnPage(page, profile("/login"), "hoi", { answerTimeoutMs: 5_000, inputTimeoutMs: 1_000 }))).rejects.toMatchObject({
      code: "auth",
    });
  });

  it("waits for the user to complete a 'verify you are human' check, then continues", { timeout: 30_000 }, async () => {
    // The "user" completes the check after 1.5 s.
    const human = (async () => {
      await new Promise((r) => setTimeout(r, 1_500));
      await page.click("#human");
    })();
    const { result } = await collect(runOnPage(page, profile("/challenge"), "Wat is KYC?", { answerTimeoutMs: 20_000, humanCheckTimeoutMs: 15_000 }));
    await human;
    expect(result.text).toContain("Antwoord op: Wat is KYC?");
  });

  it("reports a human check clearly when nobody completes it", { timeout: 30_000 }, async () => {
    await expect(collect(runOnPage(page, profile("/challenge"), "x", { answerTimeoutMs: 5_000, humanCheckTimeoutMs: 1_500 }))).rejects.toMatchObject({
      code: "human_check",
      message: expect.stringContaining("menselijke controle"),
    });
  });

  it("clicks the tool's stop button when cancelled", { timeout: 20_000 }, async () => {
    const ac = new AbortController();
    const run = async () => {
      for await (const e of runOnPage(page, profile(), "lang antwoord", { answerTimeoutMs: 20_000, signal: ac.signal })) {
        if (e.type === "text") ac.abort();
      }
    };
    await expect(run()).rejects.toMatchObject({ code: "cancelled" });
    expect(await page.evaluate(() => (window as unknown as { stopped: boolean }).stopped)).toBe(true);
  });
});

describe("BrowserProvider", () => {
  let admin: SessionUser;
  const meta = { ip: null, userAgent: "vitest" };
  beforeAll(async () => {
    await initDb();
    await loadPermissions();
    const [u] = await db().insert(schema.users).values({ email: "admin@browser.test", name: "admin", passwordHash: "x", role: "admin" }).returning();
    admin = { id: u!.id, email: u!.email, name: u!.name, role: "admin" };
  });
  afterAll(() => closeDb());

  /** Runs a provider call, answering permission requests with `decision`. */
  async function collectWithDecision(gen: AsyncGenerator<ProviderEvent>, decision: "once" | "session" | "deny") {
    const deltas: string[] = [];
    let asked = 0;
    for await (const e of gen) {
      if (e.type === "approval") {
        asked++;
        expect(resolvePending("approval", e.approval.approvalId, admin.id, decision)).toEqual({ tool: e.approval.tool });
      } else if (e.type === "text") deltas.push(e.text);
      else if (e.type === "done") return { asked, result: e.result };
    }
    throw new Error("no done event");
  }
  const ask = (provider: BrowserProvider, site: string, q: string) =>
    provider.streamChat({ providerModel: site, messages: [{ role: "user", content: q }], maxOutputTokens: 1000, context: { userId: admin.id } });

  it("does nothing while browser control is off (the default)", async () => {
    expect(browserControlMode()).toBe("off");
    registerSite(profile("/", "fixture-off"));
    await expect(ask(new BrowserProvider(), "fixture-off", "x").next()).rejects.toMatchObject({ code: "permission" });
  });

  it("asks before every action; deny stops, once allows one call, session allows until restart", { timeout: 60_000 }, async () => {
    await setBrowserControlMode(admin, "ask", meta);
    registerSite(profile("/", "fixture-ask"));
    const provider = new BrowserProvider();
    await expect(collectWithDecision(ask(provider, "fixture-ask", "geweigerd"), "deny")).rejects.toMatchObject({ code: "permission" });
    const once = await collectWithDecision(ask(provider, "fixture-ask", "eenmalig"), "once");
    expect(once.asked).toBe(1);
    const session = await collectWithDecision(ask(provider, "fixture-ask", "sessie"), "session");
    expect(session.asked).toBe(1);
    const again = await collectWithDecision(ask(provider, "fixture-ask", "zonder vraag"), "deny");
    expect(again.asked).toBe(0); // granted for this session
    expect(again.result.text).toContain("Antwoord op: zonder vraag");

    // Turning it off again revokes session grants; the change is audited.
    await setBrowserControlMode(admin, "off", meta);
    await expect(ask(provider, "fixture-ask", "x").next()).rejects.toMatchObject({ code: "permission" });
    const audits = await db().select().from(schema.auditEvents);
    expect(audits.filter((a) => a.action === "permission.update").map((a) => a.details)).toEqual([
      { from: "off", to: "ask" },
      { from: "ask", to: "off" },
    ]);
    await setBrowserControlMode(admin, "ask", meta);
  });

  it("only admins can change the permission", async () => {
    await expect(setBrowserControlMode({ ...admin, role: "member" }, "ask", meta)).rejects.toMatchObject({ status: 403 });
  });

  it("flattens instructions and history into one prompt with the question last", () => {
    expect(
      flattenPrompt("Sys", [
        { role: "user", content: "v1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "v2" },
      ]),
    ).toBe("<instructions>\nSys\n</instructions>\n\n<previous_conversation>\nUser: v1\n\nAssistant: a1\n</previous_conversation>\n\nv2");
  });

  it("runs through the shared persistent browser and queues concurrent requests per tool", async () => {
    registerSite(profile("/", "fixture-provider"));
    const provider = new BrowserProvider();
    expect(provider.isConfigured()).toBe(true);
    const [a, b] = await Promise.all([
      collectWithDecision(ask(provider, "fixture-provider", "eerste vraag"), "session"),
      collectWithDecision(ask(provider, "fixture-provider", "tweede vraag"), "session"),
    ]);
    expect(a.result.text).toContain("Antwoord op: eerste vraag");
    expect(b.result.text).toContain("Antwoord op: tweede vraag");
  }, 30_000);

  it("refuses prompts longer than the tool accepts", async () => {
    registerSite({ ...profile("/", "fixture-small"), maxPromptChars: 10 });
    const gen = new BrowserProvider().streamChat({ providerModel: "fixture-small", messages: [{ role: "user", content: "x".repeat(50) }], maxOutputTokens: 10, context: { userId: admin.id } });
    await expect(gen.next()).rejects.toBeInstanceOf(ProviderError);
  });
});
