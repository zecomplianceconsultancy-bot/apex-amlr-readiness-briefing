import "server-only";
import { eq } from "drizzle-orm";
import { recordAudit, type RequestMeta } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import { db, schema } from "@/server/db/client";
import { forbidden } from "@/server/http/errors";
import { env } from "@/server/config/env";
import { BROWSER_CHOICES, type BrowserChoice } from "@/server/ai/browser/isolation";

/**
 * Permission for the workspace to open and operate a browser window (browser tools).
 *   "off" (default) — never; browser tools are not offered and nothing is opened.
 *   "ask"           — only after the user approves each time (or for the current session).
 * There is deliberately no "always allowed" setting.
 */
export type BrowserControlMode = "off" | "ask";
const KEY = "permission.browser_control";
/** The one browser the workspace may start; it never falls back to another. */
const CHOICE_KEY = "permission.browser_choice";

const g = globalThis as unknown as { __aiwBrowserMode?: BrowserControlMode; __aiwBrowserChoice?: BrowserChoice; __aiwSessionGrants?: Set<string> };

const isChoice = (v: unknown): v is BrowserChoice => (BROWSER_CHOICES as readonly unknown[]).includes(v);

/** The browser chosen by the admin; the configured default (Edge) until one is chosen. */
export function browserChoice(): BrowserChoice {
  return g.__aiwBrowserChoice ?? env().BROWSER_DEFAULT;
}

export async function setBrowserChoice(user: SessionUser, choice: BrowserChoice, meta: RequestMeta): Promise<void> {
  if (user.role !== "admin") throw forbidden("Alleen een beheerder kan dit wijzigen.");
  const previous = browserChoice();
  await db().transaction(async (tx) => {
    await tx
      .insert(schema.appSettings)
      .values({ key: CHOICE_KEY, value: choice, updatedBy: user.id, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: choice, updatedBy: user.id, updatedAt: new Date() } });
    await recordAudit({ action: "permission.update", actorUserId: user.id, entityType: "setting", entityId: CHOICE_KEY, details: { from: previous, to: choice }, request: meta }, tx);
  });
  g.__aiwBrowserChoice = choice;
  // Approvals were given for the previous browser.
  sessionGrants().clear();
}

/** Loaded at startup (instrumentation) and kept in memory; "off" until loaded. */
export function browserControlMode(): BrowserControlMode {
  return g.__aiwBrowserMode ?? "off";
}

export async function loadPermissions(): Promise<void> {
  const [row] = await db().select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).limit(1);
  g.__aiwBrowserMode = row?.value === "ask" ? "ask" : "off";
  const [choice] = await db().select().from(schema.appSettings).where(eq(schema.appSettings.key, CHOICE_KEY)).limit(1);
  g.__aiwBrowserChoice = isChoice(choice?.value) ? choice.value : undefined;
}

export async function setBrowserControlMode(user: SessionUser, mode: BrowserControlMode, meta: RequestMeta): Promise<void> {
  if (user.role !== "admin") throw forbidden("Alleen een beheerder kan dit wijzigen.");
  const previous = browserControlMode();
  await db().transaction(async (tx) => {
    await tx
      .insert(schema.appSettings)
      .values({ key: KEY, value: mode, updatedBy: user.id, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: mode, updatedBy: user.id, updatedAt: new Date() } });
    await recordAudit({ action: "permission.update", actorUserId: user.id, entityType: "setting", entityId: KEY, details: { from: previous, to: mode }, request: meta }, tx);
  });
  g.__aiwBrowserMode = mode;
  if (mode === "off") sessionGrants().clear();
}

// Approvals "until I close the workspace": per user and tool, in memory only.
function sessionGrants(): Set<string> {
  g.__aiwSessionGrants ??= new Set();
  return g.__aiwSessionGrants;
}
export const hasSessionGrant = (userId: string, tool: string) => sessionGrants().has(`${userId}:${tool}`);
export const addSessionGrant = (userId: string, tool: string) => sessionGrants().add(`${userId}:${tool}`);
