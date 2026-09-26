import { NextResponse } from "next/server";
import { listModelsFor, toClientModel } from "@/server/ai/catalog";
import { requireProjectRole } from "@/server/authz/project-access";
import { authed, parseId } from "@/server/http/api";
import { badRequest } from "@/server/http/errors";

/** Models with availability for a given project (credentials + data classification). */
export const GET = authed(async (req, { user }) => {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) throw badRequest("projectId is verplicht.");
  const { project } = await requireProjectRole(user, parseId(projectId, "Project"), "viewer");
  return NextResponse.json({ models: listModelsFor(project.classification).map(toClientModel) });
});
