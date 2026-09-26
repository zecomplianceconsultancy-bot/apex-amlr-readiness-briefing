import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, parseJson } from "@/server/http/api";
import { browserControlMode, setBrowserControlMode } from "@/server/settings/permissions";

export const GET = authed(async () => NextResponse.json({ mode: browserControlMode() }));

/** Admin only; every change is written to the audit trail. */
export const PUT = authed(async (req, { user, meta }) => {
  const { mode } = await parseJson(req, z.object({ mode: z.enum(["off", "ask"]) }));
  await setBrowserControlMode(user, mode, meta);
  return NextResponse.json({ mode });
});
