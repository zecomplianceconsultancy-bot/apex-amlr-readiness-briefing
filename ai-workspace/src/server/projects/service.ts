import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { recordAudit, type RequestMeta } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import { requireProjectRole, type ProjectRole } from "@/server/authz/project-access";
import { db, schema, type DbOrTx } from "@/server/db/client";
import { findModel } from "@/server/ai/registry";
import { badRequest, notFound } from "@/server/http/errors";
import type { Classification } from "@/server/security/data-policy";

const { projects, projectMembers, projectContextVersions, users } = schema;

export async function listProjectsForUser(userId: string) {
  return db()
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      classification: projects.classification,
      updatedAt: projects.updatedAt,
      role: projectMembers.role,
    })
    .from(projects)
    .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)))
    .where(isNull(projects.archivedAt))
    .orderBy(desc(projects.updatedAt));
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  classification: Classification;
  piiRedaction: boolean;
  context?: string;
}

export async function createProject(user: SessionUser, input: CreateProjectInput, meta: RequestMeta) {
  return db().transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        name: input.name,
        description: input.description ?? "",
        classification: input.classification,
        piiRedaction: input.piiRedaction,
        createdBy: user.id,
      })
      .returning();
    await tx.insert(projectMembers).values({ projectId: project!.id, userId: user.id, role: "owner" });
    if (input.context?.trim()) {
      await tx
        .insert(projectContextVersions)
        .values({ projectId: project!.id, version: 1, content: input.context, createdBy: user.id });
    }
    await recordAudit(
      {
        action: "project.create",
        actorUserId: user.id,
        projectId: project!.id,
        entityType: "project",
        entityId: project!.id,
        details: { name: input.name, classification: input.classification, piiRedaction: input.piiRedaction },
        request: meta,
      },
      tx,
    );
    return project!;
  });
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  classification?: Classification;
  piiRedaction?: boolean;
  defaultModelId?: string | null;
}

/** Settings changes are owner-only and audited with a before/after diff. */
export async function updateProject(user: SessionUser, projectId: string, patch: UpdateProjectInput, meta: RequestMeta) {
  const { project } = await requireProjectRole(user, projectId, "owner");
  if (patch.defaultModelId && !findModel(patch.defaultModelId)) throw badRequest("Onbekend model.");

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(patch) as [keyof UpdateProjectInput, unknown][]) {
    if (v !== undefined && project[k] !== v) changes[k] = { from: project[k], to: v };
  }
  if (Object.keys(changes).length === 0) return project;

  return db().transaction(async (tx) => {
    const [updated] = await tx
      .update(projects)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning();
    await recordAudit(
      { action: "project.update", actorUserId: user.id, projectId, entityType: "project", entityId: projectId, details: { changes }, request: meta },
      tx,
    );
    return updated!;
  });
}

// ---------------------------------------------------------------------------
// Versioned project context
// ---------------------------------------------------------------------------

export async function getLatestContext(projectId: string, tx: DbOrTx = db()) {
  const [row] = await tx
    .select()
    .from(projectContextVersions)
    .where(eq(projectContextVersions.projectId, projectId))
    .orderBy(desc(projectContextVersions.version))
    .limit(1);
  return row ?? null;
}

export async function listContextVersions(projectId: string) {
  return db()
    .select({
      id: projectContextVersions.id,
      version: projectContextVersions.version,
      content: projectContextVersions.content,
      createdAt: projectContextVersions.createdAt,
      createdBy: users.name,
    })
    .from(projectContextVersions)
    .innerJoin(users, eq(users.id, projectContextVersions.createdBy))
    .where(eq(projectContextVersions.projectId, projectId))
    .orderBy(desc(projectContextVersions.version));
}

export async function saveContext(user: SessionUser, projectId: string, content: string, meta: RequestMeta) {
  await requireProjectRole(user, projectId, "editor");
  return db().transaction(async (tx) => {
    const latest = await getLatestContext(projectId, tx);
    if (latest?.content === content) return latest;
    const version = (latest?.version ?? 0) + 1;
    const [row] = await tx.insert(projectContextVersions).values({ projectId, version, content, createdBy: user.id }).returning();
    await recordAudit(
      {
        action: "project.context.update",
        actorUserId: user.id,
        projectId,
        entityType: "project_context_version",
        entityId: row!.id,
        details: { version, previousVersion: latest?.version ?? null, length: content.length },
        request: meta,
      },
      tx,
    );
    return row!;
  });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function listMembers(projectId: string) {
  return db()
    .select({ userId: users.id, name: users.name, email: users.email, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(users.name);
}

export async function upsertMember(user: SessionUser, projectId: string, email: string, role: ProjectRole, meta: RequestMeta) {
  await requireProjectRole(user, projectId, "owner");
  const [target] = await db().select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  if (!target || !target.isActive) throw notFound("Gebruiker");
  if (target.id === user.id) throw badRequest("Je kunt je eigen rol niet wijzigen.");
  await db().transaction(async (tx) => {
    await tx
      .insert(projectMembers)
      .values({ projectId, userId: target.id, role })
      .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role } });
    await recordAudit(
      { action: "project.member.upsert", actorUserId: user.id, projectId, entityType: "user", entityId: target.id, details: { role }, request: meta },
      tx,
    );
  });
}
