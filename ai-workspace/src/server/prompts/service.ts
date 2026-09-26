import "server-only";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { SessionUser } from "@/server/auth/session";
import { requireProjectRole } from "@/server/authz/project-access";
import { db, schema } from "@/server/db/client";
import { forbidden, notFound } from "@/server/http/errors";

const t = schema.promptTemplates;

/** Project prompts (shared with members) plus the user's personal prompts. */
export async function listPrompts(user: SessionUser, projectId: string) {
  await requireProjectRole(user, projectId, "viewer");
  return db()
    .select({ id: t.id, title: t.title, body: t.body, projectId: t.projectId, ownerId: t.ownerId })
    .from(t)
    .where(or(eq(t.projectId, projectId), and(isNull(t.projectId), eq(t.ownerId, user.id))))
    .orderBy(desc(t.createdAt));
}

export async function createPrompt(user: SessionUser, input: { projectId: string; shared: boolean; title: string; body: string }) {
  await requireProjectRole(user, input.projectId, input.shared ? "editor" : "viewer");
  const [row] = await db()
    .insert(t)
    .values({ projectId: input.shared ? input.projectId : null, ownerId: user.id, title: input.title, body: input.body })
    .returning({ id: t.id });
  return row!;
}

export async function deletePrompt(user: SessionUser, id: string) {
  const [row] = await db().select().from(t).where(eq(t.id, id)).limit(1);
  if (!row) throw notFound("Prompt");
  if (row.ownerId !== user.id) {
    // Shared prompts may also be removed by project owners.
    if (!row.projectId) throw notFound("Prompt");
    const { role } = await requireProjectRole(user, row.projectId, "viewer");
    if (role !== "owner") throw forbidden("Alleen de maker of een projecteigenaar kan deze prompt verwijderen.");
  }
  await db().delete(t).where(eq(t.id, id));
}
