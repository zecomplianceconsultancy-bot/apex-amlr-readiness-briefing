import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAllowedUrl, prepareWorkProfile } from "@/server/ai/browser/isolation";
import { browserContext, closeBrowser, workProfileDir } from "@/server/ai/browser/session";
import { registerSite } from "@/server/ai/browser/sites";
import type { SessionUser } from "@/server/auth/session";
import { env } from "@/server/config/env";
import { closeDb, db, initDb, schema } from "@/server/db/client";
import { browserChoice, loadPermissions, setBrowserChoice } from "@/server/settings/permissions";
import { fixtureSelectors, startFixtureSite } from "./fixtures/chat-site";

describe("allowed websites in the controlled window", () => {
  const tools = ["perplexity.ai", "chatgpt.com", "openai.com", "claude.ai", "gemini.google.com"];
  it.each([
    ["https://www.perplexity.ai/search?q=x", true],
    ["https://chatgpt.com/", true],
    ["https://auth.openai.com/log-in", true],
    ["https://gemini.google.com/app", true],
    ["https://accounts.google.com/signin", true],
    ["https://accounts.google.nl/", true],
    ["https://login.microsoftonline.com/common", true],
    ["https://appleid.apple.com/auth", true],
    ["about:blank", true],
    ["https://www.google.com/search?q=x", false],
    ["https://mail.google.com/", false],
    ["https://example.com/", false],
    ["https://evilperplexity.ai/", false],
    ["https://perplexity.ai.evil.com/", false],
    ["https://mijnbank.nl/", false],
  ])("%s → %s", (url, allowed) => {
    expect(isAllowedUrl(url, tools)).toBe(allowed);
  });
});

describe("work profile", () => {
  const data = mkdtempSync(path.join(tmpdir(), "aiw-profile-"));
  it("refuses a normal browser profile", () => {
    expect(() => prepareWorkProfile("C:\\Users\\ze\\AppData\\Local\\Microsoft\\Edge\\User Data", data)).toThrow(/gewoon browserprofiel/);
    expect(() => prepareWorkProfile("/home/ze/.config/google-chrome", data)).toThrow(/gewoon browserprofiel/);
    expect(() => prepareWorkProfile("/Users/ze/Library/Application Support/Microsoft Edge", data)).toThrow(/gewoon browserprofiel/);
    expect(() => prepareWorkProfile("/home/ze/.config/chromium/Default", data)).toThrow(/gewoon browserprofiel/);
  });
  it("refuses an existing folder the workspace did not create", () => {
    const foreign = mkdtempSync(path.join(tmpdir(), "aiw-foreign-"));
    writeFileSync(path.join(foreign, "Local State"), "{}");
    expect(() => prepareWorkProfile(foreign, data)).toThrow(/niet door de workspace gemaakt/);
  });
  it("creates and marks its own profile inside the data folder", () => {
    const dir = path.join(data, "browser-profiles", "msedge");
    prepareWorkProfile(dir, data);
    expect(existsSync(path.join(dir, "AI-WORKSPACE-PROFIEL.txt"))).toBe(true);
    prepareWorkProfile(dir, data); // idempotent
  });
});

describe("controlled browser", () => {
  let site: Awaited<ReturnType<typeof startFixtureSite>>;
  let admin: SessionUser;
  const meta = { ip: null, userAgent: "vitest" };

  beforeAll(async () => {
    await initDb();
    await loadPermissions();
    site = await startFixtureSite();
    registerSite({ id: "fixture-isolated", label: "Fixture", newChatUrl: `${site.baseUrl}/`, ...fixtureSelectors });
    const [u] = await db().insert(schema.users).values({ email: "admin@isolation.test", name: "admin", passwordHash: "x", role: "admin" }).returning();
    admin = { id: u!.id, email: u!.email, name: u!.name, role: "admin" };
  });
  afterAll(async () => {
    await closeBrowser();
    await site?.close();
    await closeDb();
  });

  it("uses only the chosen browser; changing it is admin-only and audited", async () => {
    expect(browserChoice()).toBe("chromium"); // tests configure the bundled Chromium
    await expect(setBrowserChoice({ ...admin, role: "member" }, "msedge", meta)).rejects.toMatchObject({ status: 403 });
    await setBrowserChoice(admin, "msedge", meta);
    expect(browserChoice()).toBe("msedge");
    await loadPermissions(); // survives a restart
    expect(browserChoice()).toBe("msedge");
    await setBrowserChoice(admin, "chromium", meta);
    const audits = await db().select().from(schema.auditEvents);
    expect(audits.filter((a) => a.entityId === "permission.browser_choice").map((a) => a.details)).toEqual([
      { from: "chromium", to: "msedge" },
      { from: "msedge", to: "chromium" },
    ]);
  });

  it("starts in its own work profile and blocks websites that are not AI tools", { timeout: 60_000 }, async () => {
    const ctx = await browserContext();
    expect(workProfileDir("chromium")).toBe(path.join(env().DATA_DIR, "browser-profiles", "chromium"));
    expect(existsSync(path.join(workProfileDir("chromium"), "AI-WORKSPACE-PROFIEL.txt"))).toBe(true);

    const page = await ctx.newPage();
    await page.goto(`${site.baseUrl}/`);
    expect(await page.locator("body").innerText()).not.toContain("Geblokkeerd");

    // Same fixture server, but under a host name that is not an AI tool.
    const other = site.baseUrl.replace("127.0.0.1", "localhost");
    await page.goto(`${other}/`);
    expect(await page.locator("h1").innerText()).toBe("Geblokkeerd door AI Workspace");

    // Popups opened by a page are held to the same rule.
    await page.goto(`${site.baseUrl}/`);
    const [popup] = await Promise.all([ctx.waitForEvent("page"), page.evaluate((u) => void window.open(u), `${other}/popup`)]);
    await popup.waitForLoadState();
    expect(await popup.locator("h1").innerText()).toBe("Geblokkeerd door AI Workspace");

    await new Promise((r) => setTimeout(r, 300));
    const blocked = await db().select().from(schema.auditEvents);
    expect(blocked.filter((a) => a.action === "browser.navigation.blocked").map((a) => a.entityId)).toContain("localhost");
  });
});

