import { NextResponse } from "next/server";
import { requireProjectRole } from "@/server/authz/project-access";
import { deleteFile, downloadFile, setIncludeInContext } from "@/server/files/service";
import { authed, parseId, parseJson } from "@/server/http/api";
import { updateFileSchema } from "@/server/http/schemas";

type Params = { projectId: string; fileId: string };

export const GET = authed<Params>(async (_req, { user, params, meta }) => {
  const { project } = await requireProjectRole(user, parseId(params.projectId, "Project"), "viewer");
  const f = await downloadFile(user, project.id, parseId(params.fileId, "Bestand"), meta);
  return new Response(new Uint8Array(f.data), {
    headers: {
      "Content-Type": f.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
});

export const PATCH = authed<Params>(async (req, { user, params, meta }) => {
  const { includeInContext } = await parseJson(req, updateFileSchema);
  const { project } = await requireProjectRole(user, parseId(params.projectId, "Project"), "editor");
  await setIncludeInContext(user, project.id, parseId(params.fileId, "Bestand"), includeInContext, meta);
  return NextResponse.json({ ok: true });
});

export const DELETE = authed<Params>(async (_req, { user, params, meta }) => {
  const { project } = await requireProjectRole(user, parseId(params.projectId, "Project"), "editor");
  await deleteFile(user, project.id, parseId(params.fileId, "Bestand"), meta);
  return NextResponse.json({ ok: true });
});
