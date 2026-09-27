import "server-only";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { findModel } from "@/server/ai/registry";
import { db, schema } from "@/server/db/client";
import { tokensFromChars, type ToolPricing } from "@/lib/pricing";

type Tool = ToolPricing["tool"];
const TOOLS: Tool[] = ["perplexity", "chatgpt", "claude", "gemini"];
const PROVIDER_TOOL: Record<string, Tool> = { anthropic: "claude", openai: "chatgpt", perplexity: "perplexity" };

/** Which of the four tools an engine belongs to (browser/manual routes use the site id). */
function toolOf(modelId: string): Tool | null {
  const m = findModel(modelId);
  if (!m) return null;
  if (m.provider === "browser" || m.provider === "manual") return (TOOLS as string[]).includes(m.providerModel) ? (m.providerModel as Tool) : null;
  return PROVIDER_TOOL[m.provider] ?? null;
}

export interface ToolUsage {
  tool: Tool;
  questions: number;
  inputTokens: number;
  outputTokens: number;
  /** True when token counts are estimated from characters (manual/browser routes). */
  estimated: boolean;
}

/** The user's own successful model calls this calendar month, per tool. */
export async function monthlyUsage(userId: string): Promise<{ since: Date; usage: ToolUsage[] }> {
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), 1);
  const t = schema.modelInvocations;
  const rows = await db()
    .select({
      modelId: t.modelId,
      n: count(),
      payloadChars: sql<number>`coalesce(sum(length(${t.requestPayload}::text)), 0)`,
      answerChars: sql<number>`coalesce(sum(length(${t.responseText})), 0)`,
      inTok: sql<number>`coalesce(sum(${t.inputTokens}), 0)`,
      outTok: sql<number>`coalesce(sum(${t.outputTokens}), 0)`,
    })
    .from(t)
    .where(and(eq(t.userId, userId), eq(t.status, "success"), gte(t.startedAt, since)))
    .groupBy(t.modelId);

  const byTool = new Map<Tool, ToolUsage>(TOOLS.map((tool) => [tool, { tool, questions: 0, inputTokens: 0, outputTokens: 0, estimated: false }]));
  for (const r of rows) {
    const tool = toolOf(r.modelId);
    if (!tool) continue;
    const u = byTool.get(tool)!;
    const measured = Number(r.inTok) > 0;
    u.questions += Number(r.n);
    u.inputTokens += measured ? Number(r.inTok) : tokensFromChars(Number(r.payloadChars));
    u.outputTokens += measured ? Number(r.outTok) : tokensFromChars(Number(r.answerChars));
    u.estimated ||= !measured;
  }
  return { since, usage: [...byTool.values()] };
}
