import "server-only";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";
import { recordAudit } from "@/server/audit/audit";
import { listSites } from "./sites";

/**
 * What the controlled browser may do and see. The workspace never touches the user's own
 * browser: it starts ONE chosen browser (no fallback to another one) with its own work
 * profile, and that window may only visit the AI tools and their login pages.
 */

export const BROWSER_CHOICES = ["msedge", "chrome", "chromium"] as const;
export type BrowserChoice = (typeof BROWSER_CHOICES)[number];

export const BROWSER_LABELS: Record<BrowserChoice, string> = {
  msedge: "Microsoft Edge",
  chrome: "Google Chrome",
  chromium: "Chromium (ingebouwd)",
};

/** Where the browsers normally live; only used to tell the user what is installed. */
function candidatePaths(choice: Exclude<BrowserChoice, "chromium">): string[] {
  const pf = process.env["PROGRAMFILES"] ?? "C:\\Program Files";
  const pf86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
  const local = process.env["LOCALAPPDATA"] ?? "";
  if (process.platform === "win32") {
    return choice === "msedge"
      ? [path.join(pf86, "Microsoft/Edge/Application/msedge.exe"), path.join(pf, "Microsoft/Edge/Application/msedge.exe"), path.join(local, "Microsoft/Edge/Application/msedge.exe")]
      : [path.join(pf, "Google/Chrome/Application/chrome.exe"), path.join(pf86, "Google/Chrome/Application/chrome.exe"), path.join(local, "Google/Chrome/Application/chrome.exe")];
  }
  if (process.platform === "darwin") {
    const app = choice === "msedge" ? "Microsoft Edge.app" : "Google Chrome.app";
    return [path.join("/Applications", app), path.join(os.homedir(), "Applications", app)];
  }
  return choice === "msedge" ? ["/opt/microsoft/msedge/msedge", "/usr/bin/microsoft-edge"] : ["/opt/google/chrome/chrome", "/usr/bin/google-chrome"];
}

export function installedBrowsers(): Record<BrowserChoice, boolean> {
  let bundled = false;
  try {
    bundled = existsSync(chromium.executablePath());
  } catch {
    bundled = false;
  }
  return {
    msedge: candidatePaths("msedge").some((p) => existsSync(p)),
    chrome: candidatePaths("chrome").some((p) => existsSync(p)),
    chromium: bundled,
  };
}

// ---------------------------------------------------------------------------
// Work profile: never the user's own browser profile.

const PROFILE_MARKER = "AI-WORKSPACE-PROFIEL.txt";
const REAL_PROFILE = /[\\/](User Data|Google[\\/]Chrome|Microsoft[\\/]Edge|Microsoft Edge|google-chrome|microsoft-edge|\.config[\\/]chromium)([\\/]|$)/i;

/**
 * Refuses a profile folder that is (or lives inside) a normal browser profile, or an existing
 * folder that was not created by the workspace. Creates and marks the folder otherwise.
 */
export function prepareWorkProfile(dir: string, dataDir: string): void {
  const resolved = path.resolve(dir);
  if (REAL_PROFILE.test(resolved)) {
    throw new Error(`Weigert browserprofiel "${resolved}": dat lijkt een gewoon browserprofiel. De workspace gebruikt alleen een eigen, apart werkprofiel.`);
  }
  const insideData = !path.relative(path.resolve(dataDir), resolved).startsWith("..");
  const marker = path.join(resolved, PROFILE_MARKER);
  if (existsSync(resolved) && !existsSync(marker) && !insideData && readdirSync(resolved).length > 0) {
    throw new Error(`Weigert browserprofiel "${resolved}": de map bestaat al en is niet door de workspace gemaakt.`);
  }
  mkdirSync(resolved, { recursive: true, mode: 0o700 });
  if (!existsSync(marker)) {
    writeFileSync(
      marker,
      "Apart werkprofiel van AI Workspace.\nAlleen hierin logt de workspace in op AI-tools. Je gewone browser, tabbladen, geschiedenis en wachtwoorden blijven erbuiten.\n",
    );
  }
}

// ---------------------------------------------------------------------------
// Allowed websites in the controlled window.

/** Other domains a tool itself uses for its pages or login. */
const RELATED: Record<string, string[]> = {
  "chatgpt.com": ["openai.com"],
  "claude.ai": ["claude.com", "anthropic.com"],
};

/** Sign-in pages of the identity providers the tools offer ("Continue with Google/Microsoft/Apple"). */
const LOGIN_HOSTS = [
  /^accounts\.google\.[a-z.]+$/,
  /^(myaccount|consent|gds)\.google\.com$/,
  /^accounts\.youtube\.com$/,
  /^login\.(microsoftonline|live|microsoft)\.com$/,
  /^account\.live\.com$/,
  /^(appleid|idmsa)\.apple\.com$/,
];

export const LOGIN_PROVIDERS_LABEL = "inlogpagina's van Google, Microsoft en Apple";

const baseHost = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");

/** Domains of the configured AI tools (each covers its subdomains). */
export function allowedToolDomains(): string[] {
  const set = new Set<string>();
  for (const s of listSites()) {
    const host = baseHost(s.newChatUrl);
    set.add(host);
    for (const r of RELATED[host] ?? []) set.add(r);
  }
  return [...set];
}

export function isAllowedUrl(raw: string | URL, domains: string[] = allowedToolDomains()): boolean {
  let url: URL;
  try {
    url = typeof raw === "string" ? new URL(raw) : raw;
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return true; // about:blank, data:, blob: stay inside the page
  const host = url.hostname.toLowerCase();
  return domains.some((d) => host === d || host.endsWith(`.${d}`)) || LOGIN_HOSTS.some((re) => re.test(host));
}

const blockedPage = (host: string) => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Geblokkeerd</title></head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:15vh auto;color:#0f172a;line-height:1.5">
<h1 style="font-size:1.25rem">Geblokkeerd door AI Workspace</h1>
<p><b>${host.replace(/[^a-z0-9.-]/gi, "")}</b> hoort niet bij de AI-tools. Dit bestuurde venster mag alleen de AI-tools en hun inlogpagina's openen.</p>
<p style="color:#64748b">Open andere websites in je eigen browser.</p></body></html>`;

const lastAudit = new Map<string, number>();

/**
 * Blocks every page (tab, popup) in the controlled window that is not an AI tool or login
 * page. Embedded parts (scripts, images, captcha frames) of allowed pages are left alone.
 */
export async function restrictToAllowedSites(ctx: BrowserContext): Promise<void> {
  await ctx.route(
    (url) => !isAllowedUrl(url),
    async (route) => {
      const req = route.request();
      let topLevel = false;
      if (req.isNavigationRequest()) {
        try {
          topLevel = req.frame().parentFrame() === null;
        } catch {
          topLevel = true; // a new window (popup) whose frame does not exist yet
        }
      }
      if (!topLevel) return route.continue();
      const host = new URL(req.url()).hostname;
      const now = Date.now();
      if ((lastAudit.get(host) ?? 0) < now - 60_000) {
        lastAudit.set(host, now);
        void recordAudit({ action: "browser.navigation.blocked", actorUserId: null, entityType: "browser", entityId: host, details: { host } }).catch(() => undefined);
      }
      return route.fulfill({ status: 403, contentType: "text/html; charset=utf-8", body: blockedPage(host) });
    },
  );
}
