import { NextResponse } from "next/server";
import { requireProjectRole } from "@/server/authz/project-access";
import { authed, parseId, parseJson } from "@/server/http/api";
import { saveContextSchema } from "@/server/http/schemas";
import { listContextVersions, saveContext } from "@/server/projects/service";

type Params = { projectId: string };

export const GET = authed<Params>(async (_req, { user, params }) => {
  const { project } = await requireProjectRole(user, parseId(params.projectId, "Project"), "viewer");
  return NextResponse.json({ versions: await listContextVersions(project.id) });
});

export const PUT = authed<Params>(async (req, { user, params, meta }) => {
  const { content } = await parseJson(req, saveContextSchema);
  const version = await saveContext(user, parseId(params.projectId, "Project"), content, meta);
  return NextResponse.json({ version });
});
