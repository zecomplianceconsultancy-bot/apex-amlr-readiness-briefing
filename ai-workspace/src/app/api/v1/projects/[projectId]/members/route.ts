import { NextResponse } from "next/server";
import { requireProjectRole } from "@/server/authz/project-access";
import { authed, parseId, parseJson } from "@/server/http/api";
import { upsertMemberSchema } from "@/server/http/schemas";
import { listMembers, upsertMember } from "@/server/projects/service";

type Params = { projectId: string };

export const GET = authed<Params>(async (_req, { user, params }) => {
  const { project } = await requireProjectRole(user, parseId(params.projectId, "Project"), "viewer");
  return NextResponse.json({ members: await listMembers(project.id) });
});

export const POST = authed<Params>(async (req, { user, params, meta }) => {
  const { email, role } = await parseJson(req, upsertMemberSchema);
  const projectId = parseId(params.projectId, "Project");
  await upsertMember(user, projectId, email, role, meta);
  return NextResponse.json({ members: await listMembers(projectId) });
});
