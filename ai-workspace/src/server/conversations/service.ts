import "server-only";
import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { recordAudit, type RequestMeta } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import { db, schema } from "@/server/db/client";
import { notFound } from "@/server/http/errors";

const { conversations, messages, modelInvocations } = schema;

export const DEFAULT_CONVERSATION_TITLE = "Nieuw gesprek";

export async function listConversations(projectId: string) {
  return db()
    .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), isNull(conversations.archivedAt)))
    .orderBy(desc(conversations.updatedAt));
}

export async function createConversation(user: SessionUser, projectId: string, title: string, meta: RequestMeta) {
  return db().transaction(async (tx) => {
    const [row] = await tx.insert(conversations).values({ projectId, title, createdBy: user.id }).returning();
    await recordAudit(
      { action: "conversation.create", actorUserId: user.id, projectId, entityType: "conversation", entityId: row!.id, details: { title }, request: meta },
      tx,
    );
    return row!;
  });
}

/** Always scope by project: a conversation id alone never grants access. */
export async function getConversation(projectId: string, conversationId: string) {
  const [row] = await db()
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.projectId, projectId), isNull(conversations.archivedAt)))
    .limit(1);
  if (!row) throw notFound("Gesprek");
  return row;
}

export async function updateConversation(
  user: SessionUser,
  projectId: string,
  conversationId: string,
  patch: { title?: string; archived?: boolean },
  meta: RequestMeta,
) {
  await getConversation(projectId, conversationId);
  await db().transaction(async (tx) => {
    await tx
      .update(conversations)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.archived ? { archivedAt: new Date() } : {}),
      })
      .where(eq(conversations.id, conversationId));
    await recordAudit(
      { action: "conversation.update", actorUserId: user.id, projectId, entityType: "conversation", entityId: conversationId, details: patch, request: meta },
      tx,
    );
  });
}

/** Messages with a provenance summary of the invocation that produced each assistant turn. */
export async function listMessages(conversationId: string) {
  return db()
    .select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      status: messages.status,
      createdAt: messages.createdAt,
      invocationId: messages.invocationId,
      runId: messages.runId,
      modelId: modelInvocations.modelId,
      modelReported: modelInvocations.modelReported,
      inputTokens: modelInvocations.inputTokens,
      outputTokens: modelInvocations.outputTokens,
      latencyMs: modelInvocations.latencyMs,
      finishReason: modelInvocations.finishReason,
      citations: modelInvocations.citations,
    })
    .from(messages)
    .leftJoin(modelInvocations, eq(modelInvocations.id, messages.invocationId))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));
}

/** Full-text-ish search over conversation titles and messages in the user's projects. */
export async function searchConversations(userId: string, query: string, limit = 50) {
  const q = query.trim();
  if (q.length < 2) return [];
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db()
    .select({
      projectId: schema.projects.id,
      projectName: schema.projects.name,
      conversationId: conversations.id,
      title: conversations.title,
      messageId: messages.id,
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(schema.projects, eq(schema.projects.id, conversations.projectId))
    .innerJoin(schema.projectMembers, and(eq(schema.projectMembers.projectId, schema.projects.id), eq(schema.projectMembers.userId, userId)))
    .where(and(isNull(conversations.archivedAt), isNull(schema.projects.archivedAt), or(ilike(messages.content, pattern), ilike(conversations.title, pattern))))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
}
