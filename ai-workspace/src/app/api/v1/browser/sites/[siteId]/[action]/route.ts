import { NextResponse } from "next/server";
import { checkSite, openSite } from "@/server/ai/browser/session";
import { getSite } from "@/server/ai/browser/sites";
import { ProviderError } from "@/server/ai/types";
import { recordAudit } from "@/server/audit/audit";
import { env } from "@/server/config/env";
import { authed } from "@/server/http/api";
import { badRequest, forbidden, HttpError, notFound } from "@/server/http/errors";

type Params = { siteId: string; action: string };

/** Controls the desktop browser: admin only. POST .../open or .../check */
export const POST = authed<Params>(async (_req, { user, params, meta }) => {
  if (user.role !== "admin") throw forbidden();
  if (!env().ENABLE_BROWSER_PROVIDER) throw badRequest("Browser-tools staan uit (ENABLE_BROWSER_PROVIDER).");
  const site = getSite(params.siteId);
  if (!site) throw notFound("Browser-tool");
  try {
    if (params.action === "open") {
      await openSite(site.id);
      await recordAudit({ action: "browser.site.open", actorUserId: user.id, entityType: "browser_site", entityId: site.id, request: meta });
      return NextResponse.json({ ok: true });
    }
    if (params.action === "check") {
      const status = await checkSite(site.id);
      await recordAudit({ action: "browser.site.check", actorUserId: user.id, entityType: "browser_site", entityId: site.id, details: { state: status.state }, request: meta });
      return NextResponse.json({ status });
    }
  } catch (err) {
    if (err instanceof ProviderError) throw new HttpError(502, `browser_${err.code}`, err.message);
    throw err;
  }
  throw notFound("Actie");
});
