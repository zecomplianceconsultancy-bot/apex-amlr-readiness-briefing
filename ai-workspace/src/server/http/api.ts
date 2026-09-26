import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/server/config/env";
import { getSessionUser, type SessionUser } from "@/server/auth/session";
import type { RequestMeta } from "@/server/audit/audit";
import { badRequest, HttpError, unauthorized } from "./errors";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function requestMeta(req: Request): RequestMeta {
  // Only trust X-Forwarded-For when the app runs behind your own reverse proxy.
  const fwd = req.headers.get("x-forwarded-for");
  return {
    ip: fwd ? (fwd.split(",")[0]?.trim() ?? null) : null,
    userAgent: req.headers.get("user-agent"),
  };
}

/** CSRF defence in depth (on top of SameSite=Lax cookies): mutating calls must come from our origin. */
function assertSameOrigin(req: Request): void {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin");
  const allowed = new Set([env().APP_ORIGIN, new URL(req.url).origin]);
  if (!origin || !allowed.has(origin)) throw new HttpError(403, "bad_origin", "Cross-origin request geweigerd.");
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  console.error("[api] unhandled error", err);
  return NextResponse.json({ error: { code: "internal", message: "Interne fout." } }, { status: 500 });
}

export interface ApiContext<P> {
  user: SessionUser;
  params: P;
  meta: RequestMeta;
}

/**
 * Wraps an authenticated route handler: origin check, session check, error mapping.
 * Every API route except login goes through this.
 */
export function authed<P = Record<string, never>>(
  handler: (req: NextRequest, ctx: ApiContext<P>) => Promise<Response>,
) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }): Promise<Response> => {
    try {
      assertSameOrigin(req);
      const user = await getSessionUser();
      if (!user) throw unauthorized();
      return await handler(req, { user, params: await routeCtx.params, meta: requestMeta(req) });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Unauthenticated variant (login only). Still enforces the origin check. */
export function publicRoute(handler: (req: NextRequest) => Promise<Response>) {
  return async (req: NextRequest): Promise<Response> => {
    try {
      assertSameOrigin(req);
      return await handler(req);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function parseJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Ongeldige JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw badRequest("Validatiefout.", z.flattenError(parsed.error));
  return parsed.data;
}

export const uuidParam = z.uuid();
export function parseId(value: string, what = "Resource"): string {
  const parsed = uuidParam.safeParse(value);
  if (!parsed.success) throw new HttpError(404, "not_found", `${what} niet gevonden.`);
  return parsed.data;
}
