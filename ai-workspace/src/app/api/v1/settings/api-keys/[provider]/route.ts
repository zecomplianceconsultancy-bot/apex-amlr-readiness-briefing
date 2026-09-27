import { NextResponse } from "next/server";
import { z } from "zod";
import { authed, parseJson } from "@/server/http/api";
import { forbidden, notFound } from "@/server/http/errors";
import { apiKeyStatus, isApiProvider, monthlyBudget, setApiKey, setMonthlyBudget } from "@/server/settings/api-keys";
import { apiSpendThisMonth } from "@/server/usage/api-spend";

type Params = { provider: string };

/** Admin only. PUT { key?: string | null, budgetUsd?: number } — the key itself is never returned. */
export const PUT = authed<Params>(async (req, { user, params, meta }) => {
  if (user.role !== "admin") throw forbidden();
  if (!isApiProvider(params.provider)) throw notFound("Aanbieder");
  const p = params.provider;
  const body = await parseJson(req, z.object({ key: z.string().max(500).nullable().optional(), budgetUsd: z.number().optional() }));
  if (body.key !== undefined) await setApiKey(user, p, body.key, meta);
  if (body.budgetUsd !== undefined) await setMonthlyBudget(user, p, body.budgetUsd, meta);
  return NextResponse.json({ status: apiKeyStatus(p), budgetUsd: monthlyBudget(p), spentUsd: await apiSpendThisMonth(p) });
});
