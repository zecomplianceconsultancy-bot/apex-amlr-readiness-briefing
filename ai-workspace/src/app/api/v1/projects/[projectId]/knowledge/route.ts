import { NextResponse } from "next/server";
import { z } from "zod";
import { saveKnowledge } from "@/server/files/knowledge";
import { authed, parseId, parseJson } from "@/server/http/api";

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(200_000),
  source: z.string().max(200).optional(),
});

export const POST = authed<{ projectId: string }>(async (req, { user, params, meta }) => {
  const input = await parseJson(req, schema);
  const file = await saveKnowledge(user, parseId(params.projectId, "Project"), input, meta);
  return NextResponse.json({ file }, { status: 201 });
});
