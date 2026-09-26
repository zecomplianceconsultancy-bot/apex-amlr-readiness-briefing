import { NextResponse } from "next/server";
import { requireProjectRole } from "@/server/authz/project-access";
import { authed, parseId, parseJson } from "@/server/http/api";
import { updateProjectSchema } from "@/server/http/schemas";
import { updateProject } from "@/server/projects/service";

type Params = { projectId: string };

export const GET = authed<Params>(async (_req, { user, params }) => {
  const { project, role } = await requireProjectRole(user, parseId(params.projectId, "Project"), "viewer");
  return NextResponse.json({ project, role });
});

export const PATCH = authed<Params>(async (req, { user, params, meta }) => {
  const patch = await parseJson(req, updateProjectSchema);
  const project = await updateProject(user, parseId(params.projectId, "Project"), patch, meta);
  return NextResponse.json({ project });
});
