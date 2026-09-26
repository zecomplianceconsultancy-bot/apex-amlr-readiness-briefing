import "server-only";
import { and, desc, eq, lt } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { notFound } from "@/server/http/errors";

const { auditEvents, users, modelInvocations } = schema;

export async function listAuditEvents(opts: { projectId?: string; beforeSeq?: number; limit?: number }) {
  const conditions = [
    opts.projectId ? eq(auditEvents.projectId, opts.projectId) : undefined,
    opts.beforeSeq ? lt(auditEvents.seq, opts.beforeSeq) : undefined,
  ].filter(Boolean);
  return db()
    .select({
      seq: auditEvents.seq,
      occurredAt: auditEvents.occurredAt,
      action: auditEvents.action,
      actorType: auditEvents.actorType,
      actorName: users.name,
      projectId: auditEvents.projectId,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      ip: auditEvents.ip,
      details: auditEvents.details,
      hash: auditEvents.hash,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditEvents.seq))
    .limit(Math.min(opts.limit ?? 100, 500));
}

/** Full provenance record of one model call, scoped to its project. */
export async function getInvocation(projectId: string, invocationId: string) {
  const [row] = await db()
    .select({ invocation: modelInvocations, userName: users.name })
    .from(modelInvocations)
    .innerJoin(users, eq(users.id, modelInvocations.userId))
    .where(and(eq(modelInvocations.id, invocationId), eq(modelInvocations.projectId, projectId)))
    .limit(1);
  if (!row) throw notFound("Invocatie");
  return { ...row.invocation, userName: row.userName };
}
