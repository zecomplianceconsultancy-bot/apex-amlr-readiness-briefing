import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import type { SessionUser } from "@/server/auth/session";
import { forbidden, notFound } from "@/server/http/errors";

export type ProjectRole = "owner" | "editor" | "viewer";
const RANK: Record<ProjectRole, number> = { viewer: 1, editor: 2, owner: 3 };

export type ProjectRow = typeof schema.projects.$inferSelect;

/**
 * Need-to-know access: project data is visible only to project members. The global "admin"
 * role manages users and reads the audit trail, but does NOT implicitly see project content.
 *
 * Non-members get 404 (not 403) so project existence is not disclosed.
 */
export async function requireProjectRole(
  user: SessionUser,
  projectId: string,
  minRole: ProjectRole,
): Promise<{ project: ProjectRow; role: ProjectRole }> {
  const [row] = await db()
    .select({ project: schema.projects, role: schema.projectMembers.role })
    .from(schema.projects)
    .innerJoin(
      schema.projectMembers,
      and(eq(schema.projectMembers.projectId, schema.projects.id), eq(schema.projectMembers.userId, user.id)),
    )
    .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.archivedAt)))
    .limit(1);
  if (!row) throw notFound("Project");
  if (RANK[row.role] < RANK[minRole]) throw forbidden();
  return row;
}

export function canEdit(role: ProjectRole): boolean {
  return RANK[role] >= RANK.editor;
}
