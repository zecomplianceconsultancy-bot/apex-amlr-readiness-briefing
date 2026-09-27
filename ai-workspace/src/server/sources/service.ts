import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { findModel } from "@/server/ai/registry";
import { db, schema } from "@/server/db/client";

export interface ProjectSource {
  url: string;
  title: string | null;
  domain: string;
  /** How many answers cited this source. */
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  conversations: { id: string; title: string }[];
  /** Labels of the engines that cited it. */
  tools: string[];
}

/** Same page, different spelling: drop the fragment and a trailing slash. */
export function normalizeSourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * Every source the engines cited in this project, deduplicated by URL: a growing,
 * searchable library of what the project's answers are based on.
 */
export async function projectSources(projectId: string, maxInvocations = 5000): Promise<ProjectSource[]> {
  const t = schema.modelInvocations;
  const c = schema.conversations;
  const rows = await db()
    .select({ citations: t.citations, modelId: t.modelId, startedAt: t.startedAt, conversationId: t.conversationId, conversationTitle: c.title })
    .from(t)
    .leftJoin(c, eq(c.id, t.conversationId))
    .where(and(eq(t.projectId, projectId), eq(t.status, "success"), sql`jsonb_array_length(${t.citations}) > 0`))
    .orderBy(desc(t.startedAt))
    .limit(maxInvocations);

  const byUrl = new Map<string, ProjectSource & { convIds: Set<string> }>();
  for (const r of rows) {
    const tool = findModel(r.modelId)?.label ?? r.modelId;
    const seenInRow = new Set<string>();
    for (const cit of (r.citations as { url?: unknown; title?: unknown }[]) ?? []) {
      const url = normalizeSourceUrl(cit?.url);
      if (!url || seenInRow.has(url)) continue;
      seenInRow.add(url);
      let s = byUrl.get(url);
      if (!s) {
        s = {
          url,
          title: null,
          domain: new URL(url).hostname.replace(/^www\./, ""),
          count: 0,
          firstSeen: r.startedAt,
          lastSeen: r.startedAt,
          conversations: [],
          tools: [],
          convIds: new Set(),
        };
        byUrl.set(url, s);
      }
      s.count++;
      if (!s.title && typeof cit.title === "string" && cit.title.trim() && cit.title.trim() !== url) s.title = cit.title.trim().slice(0, 200);
      if (r.startedAt < s.firstSeen) s.firstSeen = r.startedAt;
      if (r.startedAt > s.lastSeen) s.lastSeen = r.startedAt;
      if (!s.tools.includes(tool)) s.tools.push(tool);
      if (r.conversationId && !s.convIds.has(r.conversationId)) {
        s.convIds.add(r.conversationId);
        s.conversations.push({ id: r.conversationId, title: r.conversationTitle ?? "Gesprek" });
      }
    }
  }
  return [...byUrl.values()]
    .map(({ convIds: _, ...s }) => s)
    .sort((a, b) => b.count - a.count || b.lastSeen.getTime() - a.lastSeen.getTime());
}
