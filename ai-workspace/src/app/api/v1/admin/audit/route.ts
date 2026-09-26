import { NextResponse } from "next/server";
import { verifyAuditChain } from "@/server/audit/audit";
import { listAuditEvents } from "@/server/audit/queries";
import { authed } from "@/server/http/api";
import { forbidden } from "@/server/http/errors";

/** Global audit trail + chain verification — platform admins only. */
export const GET = authed(async (req, { user }) => {
  if (user.role !== "admin") throw forbidden();
  const verify = req.nextUrl.searchParams.get("verify") === "1";
  const before = Number(req.nextUrl.searchParams.get("before")) || undefined;
  return NextResponse.json({
    events: await listAuditEvents({ beforeSeq: before }),
    verification: verify ? await verifyAuditChain() : null,
  });
});
