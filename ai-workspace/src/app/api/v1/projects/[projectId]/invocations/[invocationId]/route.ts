import { NextResponse } from "next/server";
import { getInvocation } from "@/server/audit/queries";
import { requireProjectRole } from "@/server/authz/project-access";
import { authed, parseId } from "@/server/http/api";

type Params = { projectId: string; invocationId: string };

export const GET = authed<Params>(async (_req, { user, params }) => {
  const { project } = await requireProjectRole(user, parseId(params.projectId, "Project"), "viewer");
  return NextResponse.json({ invocation: await getInvocation(project.id, parseId(params.invocationId, "Invocatie")) });
});
