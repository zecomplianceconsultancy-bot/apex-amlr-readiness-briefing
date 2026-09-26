import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelHandoff, completeHandoff } from "@/server/ai/handoff";
import { authed, parseJson } from "@/server/http/api";
import { notFound } from "@/server/http/errors";

const bodySchema = z.union([z.object({ text: z.string().trim().min(1).max(200_000) }), z.object({ cancel: z.literal(true) })]);

/** Completes (pasted answer) or cancels a manual-bridge step. Only the user who started it can. */
export const POST = authed<{ handoffId: string }>(async (req, { user, params }) => {
  const body = await parseJson(req, bodySchema);
  const ok = "text" in body ? completeHandoff(params.handoffId, user.id, body.text) : cancelHandoff(params.handoffId, user.id);
  if (!ok) throw notFound("Openstaande stap");
  return NextResponse.json({ ok: true });
});
