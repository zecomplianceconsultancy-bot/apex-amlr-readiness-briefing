import { NextResponse } from "next/server";
import { authed, parseJson } from "@/server/http/api";
import { createProjectSchema } from "@/server/http/schemas";
import { createProject, listProjectsForUser } from "@/server/projects/service";

export const GET = authed(async (_req, { user }) => NextResponse.json({ projects: await listProjectsForUser(user.id) }));

export const POST = authed(async (req, { user, meta }) => {
  const input = await parseJson(req, createProjectSchema);
  const project = await createProject(user, input, meta);
  return NextResponse.json({ project }, { status: 201 });
});
