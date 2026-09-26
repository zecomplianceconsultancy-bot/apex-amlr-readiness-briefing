import { NextResponse } from "next/server";
import { siteStatuses } from "@/server/ai/browser/session";
import { listSites } from "@/server/ai/browser/sites";
import { env } from "@/server/config/env";
import { authed } from "@/server/http/api";
import { forbidden } from "@/server/http/errors";

export const GET = authed(async (_req, { user }) => {
  if (user.role !== "admin") throw forbidden();
  const statuses = siteStatuses();
  return NextResponse.json({
    enabled: env().ENABLE_BROWSER_PROVIDER,
    sites: listSites().map((s) => ({ id: s.id, label: s.label, url: s.newChatUrl, status: statuses[s.id] })),
  });
});
