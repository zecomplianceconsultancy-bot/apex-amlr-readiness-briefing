import { NextResponse } from "next/server";
import { authed } from "@/server/http/api";
import { forbidden, notFound } from "@/server/http/errors";
import { isApiProvider } from "@/server/settings/api-keys";
import { testApiKey } from "@/server/settings/api-test";

type Params = { provider: string };

/** Admin only: checks the stored key against the provider. */
export const POST = authed<Params>(async (_req, { user, params }) => {
  if (user.role !== "admin") throw forbidden();
  if (!isApiProvider(params.provider)) throw notFound("Aanbieder");
  return NextResponse.json(await testApiKey(params.provider));
});
