import "server-only";
import { asc, desc, sql } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@/server/db/client";
import { computeAuditHash, GENESIS_HASH, verifyChain, type VerifyResult } from "./chain";

export type AuditAction =
  | "auth.login.success"
  | "auth.login.failure"
  | "auth.logout"
  | "user.create"
  | "project.create"
  | "project.update"
  | "project.member.upsert"
  | "project.context.update"
  | "conversation.create"
  | "conversation.update"
  | "file.upload"
  | "file.update"
  | "file.delete"
  | "file.download"
  | "ai.invocation.completed"
  | "ai.invocation.failed"
  | "ai.invocation.blocked"
  | "ai.invocation.cancelled"
  | "browser.site.open"
  | "browser.site.check"
  | "browser.navigation.blocked"
  | "permission.update"
  | "settings.api_key"
  | "settings.budget"
  | "permission.approval";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface AuditInput {
  action: AuditAction;
  actorUserId: string | null;
  actorType?: "user" | "system";
  projectId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  details?: Record<string, unknown>;
  request?: RequestMeta;
}

// Arbitrary constant identifying the audit-chain advisory lock.
const AUDIT_LOCK_KEY = 7_412_001;

/**
 * Append an event to the hash-chained audit log.
 *
 * Pass the caller's transaction so the audit entry commits atomically with the change it
 * describes. A transaction-scoped advisory lock serializes writers so the chain never forks.
 */
export async function recordAudit(input: AuditInput, tx?: DbOrTx): Promise<void> {
  const run = async (t: DbOrTx) => {
    await t.execute(sql`select pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`);
    const [last] = await t
      .select({ hash: schema.auditEvents.hash })
      .from(schema.auditEvents)
      .orderBy(desc(schema.auditEvents.seq))
      .limit(1);
    const prevHash = last?.hash ?? GENESIS_HASH;
    const entry = {
      occurredAt: new Date(),
      actorUserId: input.actorUserId,
      actorType: input.actorType ?? (input.actorUserId ? "user" : "system"),
      action: input.action,
      projectId: input.projectId ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      ip: input.request?.ip ?? null,
      userAgent: input.request?.userAgent ?? null,
      // Round-trip through JSON so the hashed value equals what jsonb stores.
      details: JSON.parse(JSON.stringify(input.details ?? {})) as Record<string, unknown>,
    };
    await t.insert(schema.auditEvents).values({ ...entry, prevHash, hash: computeAuditHash(prevHash, entry) });
  };

  // A transaction handle cannot open a nested transaction via db().transaction, so only
  // start one when the caller did not pass one.
  if (tx) await run(tx);
  else await db().transaction(run);
}

/** Recompute the whole chain. O(n); fine for the MVP, batch/checkpoint later. */
export async function verifyAuditChain(): Promise<VerifyResult> {
  const rows = await db().select().from(schema.auditEvents).orderBy(asc(schema.auditEvents.seq));
  return verifyChain(rows);
}
