import "server-only";
import { eq } from "drizzle-orm";
import { recordAudit, type RequestMeta } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import { db, schema } from "@/server/db/client";
import { forbidden } from "@/server/http/errors";

/**
 * Permission for the workspace to open and operate a Chrome window (browser tools).
 *   "off" (default) — never; browser tools are not offered and nothing is opened.
 *   "ask"           — only after the user approves each time (or for the current session).
 * There is deliberately no "always allowed" setting.
 */
export type BrowserControlMode = "off" | "ask";
const KEY = "permission.browser_control";

const g = globalThis as unknown as { __aiwBrowserMode?: BrowserControlMode; __aiwSessionGrants?: Set<string> };

/** Loaded at startup (instrumentation) and kept in memory; "off" until loaded. */
export function browserControlMode(): BrowserControlMode {
  return g.__aiwBrowserMode ?? "off";
}

export async function loadPermissions(): Promise<void> {
  const [row] = await db().select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).limit(1);
  g.__aiwBrowserMode = row?.value === "ask" ? "ask" : "off";
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
