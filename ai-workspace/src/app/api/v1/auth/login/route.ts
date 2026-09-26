import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { recordAudit } from "@/server/audit/audit";
import { dummyPasswordHash, verifyPassword } from "@/server/auth/password";
import { hitRateLimit, resetRateLimit } from "@/server/auth/rate-limit";
import { createSession } from "@/server/auth/session";
import { db, schema } from "@/server/db/client";
import { parseJson, publicRoute, requestMeta } from "@/server/http/api";
import { HttpError } from "@/server/http/errors";
import { loginSchema } from "@/server/http/schemas";

export const POST = publicRoute(async (req) => {
  const { email: rawEmail, password } = await parseJson(req, loginSchema);
  const email = rawEmail.toLowerCase();
  const meta = requestMeta(req);

  const limiterKey = `login:${meta.ip ?? "unknown"}:${email}`;
  const limit = hitRateLimit(limiterKey, 10, 15 * 60_000);
  if (!limit.allowed) {
    throw new HttpError(429, "rate_limited", `Te veel pogingen. Probeer het over ${Math.ceil(limit.retryAfterMs / 60_000)} minuten opnieuw.`);
  }

  const [user] = await db().select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  // Always run a hash verification so response time does not reveal whether the account exists.
  const ok = await verifyPassword(user?.passwordHash ?? (await dummyPasswordHash()), password);

  if (!user || !ok || !user.isActive) {
    await recordAudit({
      action: "auth.login.failure",
      actorUserId: user?.id ?? null,
      actorType: "system",
      entityType: "user",
      entityId: user?.id ?? null,
      details: { email, reason: !user ? "unknown_user" : !user.isActive ? "inactive" : "bad_password" },
      request: meta,
    });
    throw new HttpError(401, "invalid_credentials", "Onjuiste e-mail of wachtwoord.");
  }

  resetRateLimit(limiterKey);
  await createSession(user.id, meta);
  await db().update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
  await recordAudit({ action: "auth.login.success", actorUserId: user.id, entityType: "user", entityId: user.id, request: meta });
  return NextResponse.json({ ok: true });
});
