import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, parseId, parseJson } from "@/server/http/api";
import { badRequest } from "@/server/http/errors";
import { createPrompt, listPrompts } from "@/server/prompts/service";

const createSchema = z.object({
  projectId: z.uuid(),
  shared: z.boolean().default(false),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(20_000),
});

export const GET = authed(async (req, { user }) => {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) throw badRequest("projectId is verplicht.");
  return NextResponse.json({ prompts: await listPrompts(user, parseId(projectId, "Project")) });
});

export const POST = authed(async (req, { user }) => {
  const input = await parseJson(req, createSchema);
  return NextResponse.json({ prompt: await createPrompt(user, input) }, { status: 201 });
});
