import "server-only";
import { and, count, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import { HttpError } from "@/server/http/errors";
import { API_PROVIDER_INFO, monthlyBudget, type ApiProvider } from "@/server/settings/api-keys";
import { formatUsd, modelApiPrice } from "@/lib/pricing";

/**
 * Estimated API spend this calendar month per provider (all users), from the token counts the
 * providers report on every call. The provider's own dashboard is the authority; this estimate
 * errs on the high side so the workspace stops before the real limit.
 */
const monthStart = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1);
};
const monthKey = () => monthStart().toISOString().slice(0, 7);

const g = globalThis as unknown as { __aiwSpend?: { month: string; usd: Map<ApiProvider, number> } };

export async function apiSpendThisMonth(p: ApiProvider): Promise<number> {
  const t = schema.modelInvocations;
  const rows = await db()
    .select({
      modelId: t.modelId,
      calls: count(),
      inTok: sql<number>`coalesce(sum(${t.inputTokens}), 0)`,
      outTok: sql<number>`coalesce(sum(${t.outputTokens}), 0)`,
    })
    .from(t)
    .where(and(eq(t.provider, p), gte(t.startedAt, monthStart()), isNotNull(t.inputTokens)))
    .groupBy(t.modelId);
  const usd = rows.reduce((sum, r) => {
    const price = modelApiPrice(r.modelId);
    return sum + (Number(r.inTok) * price.input + Number(r.outTok) * price.output) / 1_000_000 + Number(r.calls) * (price.perRequest ?? 0);
  }, 0);
  const cache = (g.__aiwSpend = g.__aiwSpend?.month === monthKey() ? g.__aiwSpend : { month: monthKey(), usd: new Map() });
  cache.usd.set(p, usd);
  return usd;
}

/** Last known spend (sync, for the model list); refreshed after every API call. */
export function cachedSpend(p: ApiProvider): number {
  return g.__aiwSpend?.month === monthKey() ? (g.__aiwSpend.usd.get(p) ?? 0) : 0;
}

export function budgetReachedMessage(p: ApiProvider, spent: number): string {
  return `Maandbudget voor ${API_PROVIDER_INFO[p].label} bereikt (≈ ${formatUsd(spent)} van ${formatUsd(monthlyBudget(p))}). Verhoog het onder API-koppelingen, of gebruik deze maand de handmatige route.`;
}

/** Refuses a call when this month's estimated spend has reached the budget. */
export async function assertWithinBudget(p: ApiProvider): Promise<void> {
  const spent = await apiSpendThisMonth(p);
  if (spent >= monthlyBudget(p)) throw new HttpError(402, "budget_reached", budgetReachedMessage(p, spent));
}
