import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { env } from "@/server/config/env";
import { db, schema } from "@/server/db/client";
import { randomToken, sha256Hex } from "@/server/security/crypto";
import type { RequestMeta } from "@/server/audit/audit";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
}

// Secure cookies need HTTPS. On the desktop the app runs on http://127.0.0.1 (local only).
const isHttps = () => env().APP_ORIGIN.startsWith("https://");
// "__Host-" cookies must be Secure, host-only and Path=/ — browsers enforce it.
export const sessionCookieName = () => (isHttps() ? "__Host-aiw_session" : "aiw_session");

export async function createSession(userId: string, meta: RequestMeta): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_HOURS * 3600_000);
  await db()
    .insert(schema.sessions)
    .values({ tokenHash: sha256Hex(token), userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent });
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: isHttps(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Resolves the current user, memoized per request. Returns null when not logged in. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;
  const [row] = await db()
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(
      and(
        eq(schema.sessions.tokenHash, sha256Hex(token)),
        gt(schema.sessions.expiresAt, new Date()),
        eq(schema.users.isActive, true),
      ),
    )
    .limit(1);
  return row ?? null;
});

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (token) await db().delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256Hex(token)));
  store.delete(sessionCookieName());
}
