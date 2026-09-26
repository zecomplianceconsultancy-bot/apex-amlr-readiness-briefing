import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { env } from "@/server/config/env";
import { ProviderError } from "../types";
import { HUMAN_CHECK_MESSAGE, isHumanCheck, waitForHuman } from "./challenge";
import { getSite, listSites } from "./sites";

/**
 * One persistent browser profile for the whole app, with one tab per AI tool.
 *
 * The user logs in to each tool once, by hand, in this window (2FA/captcha included); the
 * profile keeps the session. The app never sees or stores passwords. Deliberately no
 * "stealth" tricks: if a site refuses automated use, that tool should move to its API.
 */
interface BrowserState {
  context?: Promise<BrowserContext>;
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
const state: BrowserState = (g.__aiwBrowser ??= { pages: new Map(), locks: new Map(), status: new Map() });

function launch(): Promise<BrowserContext> {
  const e = env();
  const profileDir = path.resolve(e.BROWSER_PROFILE_DIR);
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  return chromium
    .launchPersistentContext(profileDir, {
      headless: e.BROWSER_HEADLESS,
      channel: e.BROWSER_CHANNEL || undefined,
      viewport: null,
    })
    .then((ctx) => {
      ctx.on("close", () => {
        state.context = undefined;
        state.pages.clear();
      });
      return ctx;
    })
    .catch((err: Error) => {
      state.context = undefined;
      throw new ProviderError(
        "browser",
        "unavailable",
        `Browser kon niet starten (${err.message.split("\n")[0]}). Is ${e.BROWSER_CHANNEL || "Chromium"} geïnstalleerd? ` +
          `Zet anders BROWSER_CHANNEL leeg en voer "npx playwright install chromium" uit.`,
      );
    });
}

export function browserContext(): Promise<BrowserContext> {
  state.context ??= launch();
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
  return status;
}

export function siteStatuses(): Record<string, SiteStatus | null> {
  return Object.fromEntries(listSites().map((s) => [s.id, state.status.get(s.id) ?? null]));
}

export function recordSiteStatus(siteId: string, status: SiteStatus): void {
  state.status.set(siteId, status);
}

export async function closeBrowser(): Promise<void> {
  const ctx = state.context;
  state.context = undefined;
  state.pages.clear();
  if (ctx) await (await ctx.catch(() => undefined))?.close();
}
