import { NextResponse } from "next/server";
import { requireProjectRole } from "@/server/authz/project-access";
import { listFiles, uploadFile } from "@/server/files/service";
import { authed, parseId } from "@/server/http/api";
import { badRequest } from "@/server/http/errors";

type Params = { projectId: string };

export const GET = authed<Params>(async (_req, { user, params }) => {
  const { project } = await requireProjectRole(user, parseId(params.projectId, "Project"), "viewer");
  return NextResponse.json({ files: await listFiles(project.id) });
});

export const POST = authed<Params>(async (req, { user, params, meta }) => {
  const { project } = await requireProjectRole(user, parseId(params.projectId, "Project"), "editor");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Geen bestand ontvangen (veld 'file').");
  const created = await uploadFile(user, project.id, file, meta);
  return NextResponse.json({ file: created }, { status: 201 });
});
