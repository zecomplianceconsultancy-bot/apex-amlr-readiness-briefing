import { NextResponse } from "next/server";
import { listAuditEvents } from "@/server/audit/queries";
import { requireProjectRole } from "@/server/authz/project-access";
import { authed, parseId } from "@/server/http/api";

type Params = { projectId: string };

/** Project audit trail — owners only. */
export const GET = authed<Params>(async (req, { user, params }) => {
  const { project } = await requireProjectRole(user, parseId(params.projectId, "Project"), "owner");
  const before = Number(req.nextUrl.searchParams.get("before")) || undefined;
  return NextResponse.json({ events: await listAuditEvents({ projectId: project.id, beforeSeq: before }) });
});
