import { NextResponse } from "next/server";
import { authed, parseId } from "@/server/http/api";
import { deletePrompt } from "@/server/prompts/service";

export const DELETE = authed<{ promptId: string }>(async (_req, { user, params }) => {
  await deletePrompt(user, parseId(params.promptId, "Prompt"));
  return NextResponse.json({ ok: true });
});
