import "server-only";
import { count, sql } from "drizzle-orm";
import { recordAudit, type RequestMeta } from "@/server/audit/audit";
import { env } from "@/server/config/env";
import { db, schema } from "@/server/db/client";
import { HttpError } from "@/server/http/errors";
import { hashPassword } from "./password";

/** First-run setup is only offered on the desktop (embedded DB) and only while no user exists. */
export async function needsSetup(): Promise<boolean> {
  if (!env().LOCAL_MODE) return false;
  const [row] = await db().select({ n: count() }).from(schema.users);
  return (row?.n ?? 0) === 0;
}

export async function createFirstAdmin(input: { name: string; email: string; password: string }, meta: RequestMeta) {
  if (!env().LOCAL_MODE) throw new HttpError(404, "not_found", "Niet beschikbaar.");
  const passwordHash = await hashPassword(input.password);
  return db().transaction(async (tx) => {
    // Serialise concurrent setup attempts; only the very first one may succeed.
    await tx.execute(sql`select pg_advisory_xact_lock(7412002)`);
    const [row] = await tx.select({ n: count() }).from(schema.users);
    if ((row?.n ?? 0) > 0) throw new HttpError(409, "already_set_up", "Er bestaat al een account. Log in.");
    const [user] = await tx
      .insert(schema.users)
      .values({ email: input.email.toLowerCase(), name: input.name, passwordHash, role: "admin" })
      .returning({ id: schema.users.id });
    await recordAudit(
      { action: "user.create", actorUserId: user!.id, entityType: "user", entityId: user!.id, details: { role: "admin", via: "first-run-setup" }, request: meta },
      tx,
    );
    return user!;
  });
}
