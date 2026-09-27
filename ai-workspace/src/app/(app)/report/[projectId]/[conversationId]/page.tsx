import Link from "next/link";
import { notFound } from "next/navigation";
import { findModel } from "@/server/ai/registry";
import { listRunsForConversation } from "@/server/ai/workflows/runs";
import { isUuid, requirePageProject } from "@/server/auth/page-guards";
import { getConversation, listMessages } from "@/server/conversations/service";
import { HttpError } from "@/server/http/errors";
import { appVersion } from "@/server/version";
import { Markdown } from "@/components/chat/markdown";
import { PrintButton } from "@/components/report/print-button";
import { CLASSIFICATION_LABELS, formatDateTime } from "@/lib/format";

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
const VERDICT_NAMES: Record<string, string> = {
  AKKOORD: "akkoord",
  AANPASSEN: "aanpassen nodig",
  ONBETROUWBAAR: "onbetrouwbaar",
  CORRECT: "feiten correct",
  FOUTEN: "fouten gevonden",
  ONZEKER: "deels onzeker",
  HOOG: "hoge overeenstemming",
  MIDDEL: "middelmatige overeenstemming",
  LAAG: "lage overeenstemming",
};
const STATUS_NAMES: Record<string, string> = { complete: "klaar", error: "fout", cancelled: "afgebroken", skipped: "overgeslagen", pending: "niet gestart", running: "niet afgerond" };

const label = (modelId: string | null) => (modelId ? (findModel(modelId)?.label ?? modelId) : "assistent");
const valid = (c: Citation[]) => c.filter((x) => typeof x.url === "string" && x.url);

function SourceList({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="mt-3 break-inside-avoid">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bronnen</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs">
        {citations.map((c) => (
          <li key={c.url} className="break-all">
            {c.title && c.title !== c.url ? `${c.title} — ` : ""}
            <a href={c.url} className="text-indigo-700">
              {c.url}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A clean, printable report of one conversation: questions, answers, workflow checks, sources, accountability. */
export default async function ReportPage({ params }: { params: Promise<{ projectId: string; conversationId: string }> }) {
  const { projectId, conversationId } = await params;
  if (!isUuid(projectId) || !isUuid(conversationId)) notFound();
  const { user, project } = await requirePageProject(projectId);
  const conversation = await getConversation(project.id, conversationId).catch((err) => {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  });
  const [messages, runs] = await Promise.all([listMessages(conversation.id), listRunsForConversation(conversation.id)]);

  const shown = messages.filter((m) => m.role === "user" || m.content.trim() || m.runId);
  const engines = new Set<string>();
  const allSources = new Map<string, Citation>();
  const invocationIds: string[] = [];
  for (const m of shown) {
    if (m.role !== "assistant") continue;
    const run = m.runId ? runs[m.runId] : undefined;
    for (const s of run?.steps ?? []) {
      if (s.status === "complete") engines.add(s.label);
      for (const c of valid(s.citations)) allSources.set(c.url!, c);
      if (s.invocationId) invocationIds.push(s.invocationId);
    }
    if (!run && m.modelId) engines.add(label(m.modelId));
    for (const c of valid((m.citations as Citation[] | null) ?? [])) allSources.set(c.url!, c);
    if (!run && m.invocationId) invocationIds.push(m.invocationId);
  }
  const sensitive = project.classification === "confidential" || project.classification === "restricted";
  let q = 0;

  return (
    <div className="h-full overflow-y-auto bg-slate-100 print:h-auto print:overflow-visible print:bg-white">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 print:hidden">
        <Link href={`/projects/${project.id}/c/${conversation.id}`} className="text-sm text-slate-600 hover:text-slate-900">
          ← Terug naar gesprek
        </Link>
        <p className="hidden text-xs text-slate-500 sm:block">Kies bij afdrukken &quot;Opslaan als PDF&quot; als printer.</p>
        <PrintButton />
      </div>

      <article className="mx-auto my-6 max-w-3xl rounded-xl bg-white p-10 shadow-sm print:my-0 print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        {sensitive && (
          <p className="mb-4 rounded bg-rose-50 px-3 py-1 text-center text-xs font-semibold uppercase tracking-widest text-rose-700 print:border print:border-rose-300">
            {CLASSIFICATION_LABELS[project.classification]} — niet verspreiden zonder toestemming
          </p>
        )}
        <header className="border-b-2 border-slate-900 pb-4">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Rapport · {project.name}</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{conversation.title}</h1>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-600 sm:grid-cols-4">
            <div>
              <dt className="text-slate-400">Datum</dt>
              <dd>{new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Opgesteld door</dt>
              <dd>{user.name}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Classificatie</dt>
              <dd>{CLASSIFICATION_LABELS[project.classification] ?? project.classification}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Gebruikte AI-tools</dt>
              <dd>{[...engines].join(", ") || "—"}</dd>
            </div>
          </dl>
        </header>

        {shown.length === 0 && <p className="mt-6 text-sm text-slate-500">Dit gesprek is nog leeg.</p>}

        {shown.map((m) => {
          if (m.role === "user") {
            q++;
            return (
              <section key={m.id} className="mt-8 break-inside-avoid">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Vraag {q}</h2>
                <p className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-900">{m.content}</p>
              </section>
            );
          }
          const run = m.runId ? runs[m.runId] : undefined;
          const final = run?.kind === "research" ? (run.steps.find((s) => s.role === "final") ?? run.steps.find((s) => s.role === "draft")) : undefined;
          const judge = run?.kind === "compare" ? run.steps.find((s) => s.role === "judge") : undefined;
          const body = run ? (final?.text || judge?.text || m.content) : m.content;
          const citations = run ? valid(run.steps.flatMap((s) => s.citations)).filter((c, i, a) => a.findIndex((x) => x.url === c.url) === i) : valid((m.citations as Citation[] | null) ?? []);
          return (
            <section key={m.id} className="mt-4 border-l-2 border-slate-200 pl-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {run ? (run.kind === "compare" ? "Vergelijking van modellen — analyse" : "Diep onderzoek — eindantwoord") : "Antwoord"}
                <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">
                  {run ? "" : `${label(m.modelId)}${m.modelReported ? ` (${m.modelReported})` : ""} · `}
                  {formatDateTime(m.createdAt)}
                </span>
              </h3>
              {body ? <Markdown>{body}</Markdown> : <p className="text-sm italic text-slate-500">Geen antwoord ({m.status}).</p>}
              {run && (
                <table className="mt-3 w-full break-inside-avoid text-left text-xs">
                  <thead className="text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="py-1 pr-2 font-medium">Stap</th>
                      <th className="py-1 pr-2 font-medium">Tool</th>
                      <th className="py-1 pr-2 font-medium">Oordeel</th>
                      <th className="py-1 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.steps.map((s) => (
                      <tr key={s.id} className="border-b border-slate-100">
                        <td className="py-1 pr-2">
                          {s.position + 1}. {ROLE_NAMES[s.role] ?? s.role}
                        </td>
                        <td className="py-1 pr-2">{s.label}</td>
                        <td className="py-1 pr-2">{s.verdict ? (VERDICT_NAMES[s.verdict] ?? s.verdict) : "—"}</td>
                        <td className="py-1">{STATUS_NAMES[s.status] ?? s.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <SourceList citations={citations} />
            </section>
          );
        })}

        {allSources.size > 0 && (
          <section className="mt-10 break-before-page border-t border-slate-300 pt-4 print:border-0 print:pt-0">
            <h2 className="text-sm font-bold text-slate-900">Bronnenlijst</h2>
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs">
              {[...allSources.values()].map((c) => (
                <li key={c.url} className="break-all">
                  {c.title && c.title !== c.url ? `${c.title} — ` : ""}
                  {c.url}
                </li>
              ))}
            </ol>
          </section>
        )}

        <footer className="mt-10 border-t border-slate-300 pt-3 text-[11px] leading-relaxed text-slate-500">
          <p>
            <strong>Verantwoording.</strong> Dit rapport bevat door AI gegenereerde tekst. Controleer feiten en bronnen voordat je het gebruikt voor
            besluiten. Per antwoord zijn het model, de exacte verzonden vraag, de context en het tijdstip vastgelegd in de audit trail van AI Workspace
            {invocationIds.length > 0 && <> (referenties: {invocationIds.map((id) => id.slice(0, 8)).join(", ")})</>}.
          </p>
          <p className="mt-1">
            Gegenereerd met AI Workspace v{appVersion()} op {formatDateTime(new Date())}.
          </p>
        </footer>
      </article>
    </div>
  );
}
