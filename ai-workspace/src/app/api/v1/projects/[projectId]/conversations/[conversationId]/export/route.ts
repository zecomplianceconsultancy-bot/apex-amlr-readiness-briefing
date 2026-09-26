import { listRunsForConversation } from "@/server/ai/workflows/runs";
import { findModel } from "@/server/ai/registry";
import { requireProjectRole } from "@/server/authz/project-access";
import { getConversation, listMessages } from "@/server/conversations/service";
import { authed, parseId } from "@/server/http/api";

type Params = { projectId: string; conversationId: string };
type Citation = { url?: string; title?: string };

const ROLE_NAMES: Record<string, string> = {
  answer: "Antwoord",
  judge: "Vergelijkende analyse",
  research: "Onderzoek",
  draft: "Uitwerking",
  review: "Controle",
  factcheck: "Feitencheck",
  final: "Eindantwoord",
};

function sources(list: Citation[]): string {
  if (!list.length) return "";
  return `\n\n**Bronnen**\n${list.map((c, i) => `${i + 1}. [${c.title || c.url}](${c.url})`).join("\n")}`;
}

/** Conversation as a Markdown document, including every workflow step, sources and models. */
export const GET = authed<Params>(async (_req, { user, params }) => {
  const { project } = await requireProjectRole(user, parseId(params.projectId, "Project"), "viewer");
  const conversation = await getConversation(project.id, parseId(params.conversationId, "Gesprek"));
  const [messages, runs] = await Promise.all([listMessages(conversation.id), listRunsForConversation(conversation.id)]);

  const parts = [`# ${conversation.title}`, `Project: ${project.name} · geëxporteerd ${new Date().toLocaleString("nl-NL")}`];
  for (const m of messages) {
    if (m.role === "user") {
      parts.push(`## Vraag\n\n${m.content}`);
      continue;
    }
    const run = m.runId ? runs[m.runId] : undefined;
    if (run) {
      parts.push(`## ${run.kind === "compare" ? "Vergelijking" : "Diep onderzoek"}`);
      for (const s of run.steps) {
        const verdict = s.verdict ? ` — oordeel: ${s.verdict}` : "";
        parts.push(`### ${s.position + 1}. ${ROLE_NAMES[s.role] ?? s.role} (${s.label})${verdict}\n\n${s.text || `_${s.status}${s.error ? `: ${s.error}` : ""}_`}${sources(s.citations)}`);
      }
    } else {
      const label = m.modelId ? (findModel(m.modelId)?.label ?? m.modelId) : "assistent";
      parts.push(`## Antwoord (${label})\n\n${m.content}${sources((m.citations as Citation[] | null) ?? [])}`);
    }
  }
  const filename = `${conversation.title.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 60) || "gesprek"}.md`;
  return new Response(parts.join("\n\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
});
