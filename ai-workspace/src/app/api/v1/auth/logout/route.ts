import { NextResponse } from "next/server";
import { recordAudit } from "@/server/audit/audit";
import { destroySession } from "@/server/auth/session";
import { authed } from "@/server/http/api";

export const POST = authed(async (_req, { user, meta }) => {
  await destroySession();
  await recordAudit({ action: "auth.logout", actorUserId: user.id, entityType: "user", entityId: user.id, request: meta });
  return NextResponse.json({ ok: true });
});
