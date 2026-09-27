import "server-only";
import { inArray } from "drizzle-orm";
import { recordAudit, type RequestMeta } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import { env } from "@/server/config/env";
import { db, schema, type DbOrTx } from "@/server/db/client";
import { badRequest, forbidden } from "@/server/http/errors";
import { decrypt, encrypt } from "@/server/security/crypto";
import { encryptionKey } from "@/server/security/keys";

/**
 * API keys entered in the app (Settings → API-koppelingen). Stored encrypted with the data key
 * (AES-256-GCM, bound to the setting name); only the last 4 characters are ever shown or
 * audited. A key in .env still works and is used when none was entered in the app.
 */
export const API_PROVIDERS = ["anthropic", "perplexity", "openai"] as const;
export type ApiProvider = (typeof API_PROVIDERS)[number];

export const API_PROVIDER_INFO: Record<ApiProvider, { label: string; keyPrefix: string; envVar: "ANTHROPIC_API_KEY" | "PERPLEXITY_API_KEY" | "OPENAI_API_KEY" }> = {
  anthropic: { label: "Claude (Anthropic)", keyPrefix: "sk-ant-", envVar: "ANTHROPIC_API_KEY" },
  perplexity: { label: "Perplexity", keyPrefix: "pplx-", envVar: "PERPLEXITY_API_KEY" },
  openai: { label: "ChatGPT (OpenAI)", keyPrefix: "sk-", envVar: "OPENAI_API_KEY" },
};

/** Monthly budget per provider when none was set: small on purpose. */
export const DEFAULT_MONTHLY_BUDGET_USD = 20;

const keySetting = (p: ApiProvider) => `apikey.${p}`;
const budgetSetting = (p: ApiProvider) => `budget.${p}`;

interface State {
  keys: Map<ApiProvider, string>;
  budgets: Map<ApiProvider, number>;
}
const g = globalThis as unknown as { __aiwApi?: State };
const state = (): State => (g.__aiwApi ??= { keys: new Map(), budgets: new Map() });

export const isApiProvider = (v: string): v is ApiProvider => (API_PROVIDERS as readonly string[]).includes(v);

/** Loaded at startup (instrumentation) and kept in memory. */
export async function loadApiSettings(): Promise<void> {
  const names = API_PROVIDERS.flatMap((p) => [keySetting(p), budgetSetting(p)]);
  const rows = await db().select().from(schema.appSettings).where(inArray(schema.appSettings.key, names));
  const s = state();
  s.keys.clear();
  s.budgets.clear();
  for (const p of API_PROVIDERS) {
    const k = rows.find((r) => r.key === keySetting(p))?.value as { enc?: string } | undefined;
    if (k?.enc) {
      try {
        s.keys.set(p, decrypt(Buffer.from(k.enc, "base64"), encryptionKey(), keySetting(p)).toString("utf8"));
      } catch {
        console.error(`[aiw] API-sleutel voor ${p} kon niet worden ontsleuteld; voer hem opnieuw in.`);
      }
    }
    const b = rows.find((r) => r.key === budgetSetting(p))?.value as { usd?: number } | undefined;
    if (typeof b?.usd === "number") s.budgets.set(p, b.usd);
  }
}

export function apiKey(p: ApiProvider): string | undefined {
  return state().keys.get(p) ?? (env()[API_PROVIDER_INFO[p].envVar] || undefined);
}

export function apiKeyStatus(p: ApiProvider): { connected: boolean; source: "app" | "env" | null; last4: string | null } {
  const inApp = state().keys.get(p);
  const key = apiKey(p);
  return { connected: Boolean(key), source: inApp ? "app" : key ? "env" : null, last4: key ? key.slice(-4) : null };
}

export function monthlyBudget(p: ApiProvider): number {
  return state().budgets.get(p) ?? DEFAULT_MONTHLY_BUDGET_USD;
}

async function upsert(tx: DbOrTx, user: SessionUser, key: string, value: unknown) {
  await tx
    .insert(schema.appSettings)
    .values({ key, value, updatedBy: user.id, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedBy: user.id, updatedAt: new Date() } });
}

/** Save (or with `null` remove) the key entered in the app. Admin only, audited without the key. */
export async function setApiKey(user: SessionUser, p: ApiProvider, raw: string | null, meta: RequestMeta): Promise<void> {
  if (user.role !== "admin") throw forbidden("Alleen een beheerder kan API-sleutels beheren.");
  const key = raw?.trim() ?? null;
  if (key !== null) {
    if (key.length < 20 || /\s/.test(key)) throw badRequest("Dit lijkt geen volledige API-sleutel. Kopieer hem opnieuw in zijn geheel.");
    if (!key.startsWith(API_PROVIDER_INFO[p].keyPrefix)) {
      throw badRequest(`Een sleutel van ${API_PROVIDER_INFO[p].label} begint met "${API_PROVIDER_INFO[p].keyPrefix}". Controleer of je de juiste sleutel hebt gekopieerd.`);
    }
  }
  await db().transaction(async (tx) => {
    if (key === null) await tx.delete(schema.appSettings).where(inArray(schema.appSettings.key, [keySetting(p)]));
    else {
      const enc = encrypt(Buffer.from(key, "utf8"), encryptionKey(), keySetting(p)).toString("base64");
      await upsert(tx, user, keySetting(p), { enc, last4: key.slice(-4) });
    }
    await recordAudit(
      { action: "settings.api_key", actorUserId: user.id, entityType: "setting", entityId: keySetting(p), details: key ? { action: "saved", last4: key.slice(-4) } : { action: "removed" }, request: meta },
      tx,
    );
  });
  if (key === null) state().keys.delete(p);
  else state().keys.set(p, key);
}

export async function setMonthlyBudget(user: SessionUser, p: ApiProvider, usd: number, meta: RequestMeta): Promise<void> {
  if (user.role !== "admin") throw forbidden("Alleen een beheerder kan het budget wijzigen.");
  if (!Number.isFinite(usd) || usd < 0 || usd > 10_000) throw badRequest("Kies een budget tussen $0 en $10.000.");
  const previous = monthlyBudget(p);
  await db().transaction(async (tx) => {
    await upsert(tx, user, budgetSetting(p), { usd });
    await recordAudit({ action: "settings.budget", actorUserId: user.id, entityType: "setting", entityId: budgetSetting(p), details: { from: previous, to: usd }, request: meta }, tx);
  });
  state().budgets.set(p, usd);
}
