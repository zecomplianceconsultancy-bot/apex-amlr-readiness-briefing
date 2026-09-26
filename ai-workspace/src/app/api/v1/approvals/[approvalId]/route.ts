import { NextResponse } from "next/server";
import { z } from "zod";
import { resolvePending } from "@/server/ai/pending";
import { recordAudit } from "@/server/audit/audit";
import { authed, parseJson } from "@/server/http/api";
import { notFound } from "@/server/http/errors";

/** The user's answer to a permission request: once, until the workspace closes, or deny. */
export const POST = authed<{ approvalId: string }>(async (req, { user, params, meta }) => {
  const { decision } = await parseJson(req, z.object({ decision: z.enum(["once", "session", "deny"]) }));
  const info = resolvePending("approval", params.approvalId, user.id, decision);
  if (!info) throw notFound("Openstaande toestemmingsvraag");
  await recordAudit({
    action: "permission.approval",
    actorUserId: user.id,
    entityType: "browser_site",
    entityId: String(info.tool ?? ""),
    details: { decision, scope: "browser_control" },
    request: meta,
  });
  return NextResponse.json({ ok: true });
});
