import "server-only";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { env } from "@/server/config/env";
import { browserChoice } from "@/server/settings/permissions";
import { ProviderError } from "../types";
import { HUMAN_CHECK_MESSAGE, isHumanCheck, waitForHuman } from "./challenge";
import { BROWSER_LABELS, prepareWorkProfile, restrictToAllowedSites, type BrowserChoice } from "./isolation";
import { getSite, listSites } from "./sites";

/**
 * One persistent work profile for the whole app, with one tab per AI tool.
 *
 * Only the browser the admin chose is started (never another one as fallback), in its own
 * work profile under DATA_DIR: the user's normal browser windows, tabs, history, passwords
 * and extensions stay out of reach, and the window may only open the AI tools and their
 * login pages (./isolation.ts).
 *
 * The user logs in to each tool once, by hand, in this window (2FA/captcha included); the
 * profile keeps the session. The app never sees or stores passwords. Deliberately no
 * "stealth" tricks: if a site refuses automated use, that tool should move to its API.
 */
interface BrowserState {
  context?: Promise<BrowserContext>;
  /** Browser the running context was started with. */
  choice?: BrowserChoice;
  live?: BrowserContext;
  pages: Map<string, Page>;
  locks: Map<string, Promise<void>>;
  status: Map<string, SiteStatus>;
}

export interface SiteStatus {
  state: "ready" | "login_required" | "human_check" | "error";
  checkedAt: string;
  url?: string;
  detail?: string;
}

const g = globalThis as unknown as { __aiwBrowser?: BrowserState };
const state: BrowserState = (g.__aiwBrowser ??= { pages: new Map(), locks: new Map(), status: loadStatuses() });

// Last check results survive restarts, so a tool that is blocked stays marked as such.
function statusFile(): string {
  return path.join(env().DATA_DIR, "browser-status.json");
}
function loadStatuses(): Map<string, SiteStatus> {
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(statusFile(), "utf8")) as Record<string, SiteStatus>));
  } catch {
    return new Map();
  }
}
function saveStatuses(): void {
  try {
    mkdirSync(env().DATA_DIR, { recursive: true });
    writeFileSync(statusFile(), JSON.stringify(Object.fromEntries(state.status), null, 2));
  } catch {
    // best effort
  }
}

/** Work profile folder of one browser; profiles of different browsers are not compatible. */
export function workProfileDir(choice: BrowserChoice): string {
  const e = env();
  const dir = path.join(path.resolve(e.BROWSER_PROFILE_DIR), choice);
  // Before 1.3 there was one shared folder (used with Chrome): keep those logins.
  const legacy = path.join(e.DATA_DIR, "browser-profile");
  if (choice === "chrome" && !existsSync(dir) && existsSync(legacy)) {
    mkdirSync(path.dirname(dir), { recursive: true });
    renameSync(legacy, dir);
  }
  return dir;
}

function launch(choice: BrowserChoice): Promise<BrowserContext> {
  const e = env();
  const label = BROWSER_LABELS[choice];
  return Promise.resolve()
    .then(() => {
      const profileDir = workProfileDir(choice);
      try {
        prepareWorkProfile(profileDir, e.DATA_DIR);
      } catch (err) {
        throw new ProviderError("browser", "unavailable", err instanceof Error ? err.message : String(err));
      }
      return chromium.launchPersistentContext(profileDir, {
        headless: e.BROWSER_HEADLESS,
        // Exactly the chosen browser. Playwright fails rather than silently using another one.
        channel: choice === "chromium" ? undefined : choice,
        viewport: null,
        acceptDownloads: false,
        permissions: [], // no camera, microphone, location, notifications or clipboard
        args: ["--disable-sync"], // extensions are already disabled by Playwright
      });
    })
    .then(async (ctx) => {
      await restrictToAllowedSites(ctx);
      state.live = ctx;
      ctx.on("close", () => {
        if (state.live !== ctx) return; // an older window closing after a browser switch
        state.live = undefined;
        state.context = undefined;
        state.pages.clear();
      });
      return ctx;
    })
    .catch((err: Error) => {
      state.context = undefined;
      if (err instanceof ProviderError) throw err;
      const reason = err.message.split("\n")[0];
      throw new ProviderError(
        "browser",
        "unavailable",
        choice === "chromium"
          ? `Chromium kon niet starten (${reason}). Voer eenmalig "npx playwright install chromium" uit, of kies onder Browser-tools een andere browser.`
          : `${label} kon niet starten (${reason}). Is ${label} geïnstalleerd? De workspace gebruikt bewust alleen de gekozen browser en valt niet terug op een andere; kies anders onder Browser-tools een andere browser.`,
      );
    });
}

export function browserContext(): Promise<BrowserContext> {
  const choice = browserChoice();
  if (state.context && state.choice !== choice) void closeBrowser(); // the admin switched browsers
  if (!state.context) {
    state.choice = choice;
    state.context = launch(choice);
  }
  return state.context;
}

export async function pageFor(siteId: string): Promise<Page> {
  const existing = state.pages.get(siteId);
  if (existing && !existing.isClosed()) return existing;
  const page = await (await browserContext()).newPage();
  state.pages.set(siteId, page);
  return page;
}

/** One prompt at a time per tool tab; later requests queue. Returns the release function. */
export async function acquireSite(siteId: string): Promise<() => void> {
  const previous = state.locks.get(siteId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  state.locks.set(siteId, previous.then(() => mine));
  await previous;
  return release;
}

function requireSite(siteId: string) {
  const site = getSite(siteId);
  if (!site) throw new ProviderError("browser", "bad_request", `Onbekende browser-tool: ${siteId}`);
  return site;
}

/** Open the tool in its tab and bring it to the front, e.g. to log in. */
export async function openSite(siteId: string): Promise<void> {
  const site = requireSite(siteId);
  const release = await acquireSite(siteId);
  try {
    const page = await pageFor(siteId);
    await page.goto(site.newChatUrl, { waitUntil: "domcontentloaded" });
    await page.bringToFront();
  } finally {
    release();
  }
}

/** Load the tool and check whether its prompt input is usable (= logged in, selectors valid). */
export async function checkSite(siteId: string): Promise<SiteStatus> {
  const site = requireSite(siteId);
  const release = await acquireSite(siteId);
  let status: SiteStatus;
  try {
    const page = await pageFor(siteId);
    await page.goto(site.newChatUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (await isHumanCheck(page)) {
      // Give the user time to complete the check in the window that is now in front.
      if (!(await waitForHuman(page, 60_000))) {
        status = { state: "human_check", checkedAt: new Date().toISOString(), url: page.url(), detail: HUMAN_CHECK_MESSAGE(site.label) };
        state.status.set(siteId, status);
        saveStatuses();
        return status;
      }
    }
    const visible = await page
      .locator(site.input)
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true, () => false);
    status = visible
      ? { state: "ready", checkedAt: new Date().toISOString(), url: page.url() }
      : { state: "login_required", checkedAt: new Date().toISOString(), url: page.url(), detail: "Invoerveld niet gevonden: log in, of werk de selectors bij." };
  } catch (err) {
    status = { state: "error", checkedAt: new Date().toISOString(), detail: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  } finally {
    release();
  }
  state.status.set(siteId, status);
  saveStatuses();
  return status;
}

export function siteStatuses(): Record<string, SiteStatus | null> {
  return Object.fromEntries(listSites().map((s) => [s.id, state.status.get(s.id) ?? null]));
}

export function recordSiteStatus(siteId: string, status: SiteStatus): void {
  state.status.set(siteId, status);
  saveStatuses();
}

export async function closeBrowser(): Promise<void> {
  const ctx = state.context;
  state.context = undefined;
  state.live = undefined;
  state.pages.clear();
  if (ctx) await (await ctx.catch(() => undefined))?.close();
}
