import "server-only";
import { notFound, redirect } from "next/navigation";
import { requireProjectRole, type ProjectRole } from "@/server/authz/project-access";
import { HttpError } from "@/server/http/errors";
import { getSessionUser } from "./session";

/** For server components: redirect to login when there is no session. */
export async function requirePageUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** For server components: 404 unless the user is a member with at least `minRole`. */
export async function requirePageProject(projectId: string, minRole: ProjectRole = "viewer") {
  const user = await requirePageUser();
  try {
    const { project, role } = await requireProjectRole(user, projectId, minRole);
    return { user, project, role };
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
}

export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
