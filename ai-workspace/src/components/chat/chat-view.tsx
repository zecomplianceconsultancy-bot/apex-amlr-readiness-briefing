"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientModel } from "@/server/ai/catalog";
import { api, readSse, toApiError } from "@/lib/api-client";
import { bestFor } from "@/lib/strengths";
import { parseVerdict } from "@/lib/verdict";
import { Composer, type SendPayload } from "./composer";
import { CopyButton } from "./copy-button";
import { ApprovalCard, type UIApproval } from "./approval-card";
import { HandoffCard, type UIHandoff } from "./handoff-card";
import { Markdown } from "./markdown";
import { ProvenancePanel } from "./provenance-panel";
import { RunCard } from "./run-card";
import { Sources } from "./sources";
import type { MessageStats, UIMessage, UIRun, UIStep } from "./types";

interface Props {
  projectId: string;
  conversationId: string;
  title: string;
  canWrite: boolean;
  projectDefaultModelId: string | null;
  models: ClientModel[];
  initialMessages: UIMessage[];
}

const SECOND_OPINION_PROMPT =
  "🔍 Tweede mening: beoordeel het vorige antwoord kritisch. Klopt het feitelijk? Wat ontbreekt, is onzeker of te stellig? Geef concrete verbeterpunten. Sluit af met precies één regel: OORDEEL: AKKOORD, OORDEEL: AANPASSEN of OORDEEL: ONBETROUWBAAR.";

const VERDICT_BADGES: Record<string, [string, string]> = {
  AKKOORD: ["Tweede mening: akkoord", "bg-emerald-100 text-emerald-800"],
  AANPASSEN: ["Tweede mening: aanpassen", "bg-amber-100 text-amber-900"],
  ONBETROUWBAAR: ["Tweede mening: onbetrouwbaar", "bg-rose-100 text-rose-800"],
};

const FINISH_LABELS: Record<string, string> = {
  length: "Afgekapt: maximale lengte bereikt",
  refusal: "Het model weigerde dit verzoek",
  content_filter: "Geblokkeerd door contentfilter van de provider",
};

const ROUTING_LABELS: Record<string, string> = {
  manual: "zelf gekozen",
  "project-default": "projectstandaard",
  auto: "automatisch",
  "system-default": "standaard",
  "first-available": "eerste beschikbare",
};

export function ChatView(props: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<UIMessage[]>(props.initialMessages);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [provenanceId, setProvenanceId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const modelsById = useMemo(() => new Map(props.models.map((m) => [m.id, m])), [props.models]);
  const rankable = useMemo(() => props.models.map((m) => ({ id: m.id, tags: m.tags, available: m.available })), [props.models]);

  /** One click: a different engine, chosen on strengths, critically reviews the answer. */
  const secondOpinion = (m: UIMessage) => {
    const reviewer = bestFor("review", rankable, m.stats?.modelId ? [m.stats.modelId] : []);
    void send({ mode: "chat", text: SECOND_OPINION_PROMPT, modelId: reviewer });
  };
  const saveKnowledge = async (m: UIMessage) => {
    await api(`/api/v1/projects/${props.projectId}/knowledge`, {
      method: "POST",
      json: { title: props.title, content: m.content, source: `gesprek "${props.title}"` },
    });
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const patch = (id: string, fn: (m: UIMessage) => Partial<UIMessage>) => setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...fn(m) } : m)));
  const patchStep = (messageId: string, stepId: string, fn: (s: UIStep) => Partial<UIStep>) =>
    patch(messageId, (m) => (m.run ? { run: { ...m.run, steps: m.run.steps.map((s) => (s.id === stepId ? { ...s, ...fn(s) } : s)) } } : {}));

  async function send(p: SendPayload) {
    setError(null);
    setBusy(true);
    const tempUser = `tmp-user-${Date.now()}`;
    let assistantId = `tmp-assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempUser, role: "user", content: p.text, status: "complete" },
      { id: assistantId, role: "assistant", content: "", status: "streaming" },
    ]);

    const base = `/api/v1/projects/${props.projectId}/conversations/${props.conversationId}`;
    const [url, body] =
      p.mode === "chat"
        ? [`${base}/messages`, { content: p.text, modelId: p.modelId }]
        : p.mode === "compare"
          ? [`${base}/runs`, { kind: "compare", question: p.text, modelIds: p.modelIds, judgeModelId: p.judgeModelId }]
          : [`${base}/runs`, { kind: "research", question: p.text, research: p.research, draft: p.draft, review: p.review, factcheck: p.factcheck, final: p.final }];

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      if (!res.ok) throw await toApiError(res);

      for await (const { event, data } of readSse(res)) {
        const d = data as Record<string, unknown>;
        switch (event) {
          // ---- single-model chat ----
          case "meta": {
            const newId = d.assistantMessageId as string;
            const stats: MessageStats = {
              invocationId: d.invocationId as string,
              modelId: (d.model as { id: string }).id,
              modelReported: null,
              inputTokens: null,
              outputTokens: null,
              latencyMs: null,
              finishReason: null,
              redactions: d.redactions as number,
              routing: d.routing as MessageStats["routing"],
            };
            // State updaters run later, so capture the placeholder id before reassigning it.
            const placeholderId = assistantId;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId ? { ...m, id: newId, stats, warnings: d.warnings as string[] } : m.id === tempUser ? { ...m, id: d.userMessageId as string } : m,
              ),
            );
            assistantId = newId;
            break;
          }
          case "delta":
            patch(assistantId, (m) => ({ content: m.content + (d.text as string), handoff: null, approval: null }));
            break;
          case "handoff":
            patch(assistantId, () => ({ handoff: d.handoff as UIHandoff, approval: null }));
            break;
          case "step-handoff":
            patchStep(assistantId, d.stepId as string, () => ({ handoff: d.handoff as UIHandoff, approval: null }));
            break;
          case "approval":
            patch(assistantId, () => ({ approval: d.approval as UIApproval }));
            break;
          case "step-approval":
            patchStep(assistantId, d.stepId as string, () => ({ approval: d.approval as UIApproval }));
            break;

          // ---- multi-model runs ----
          case "run": {
            const newId = d.assistantMessageId as string;
            const run: UIRun = {
              id: d.runId as string,
              kind: d.kind as UIRun["kind"],
              status: "running",
              steps: (d.steps as Omit<UIStep, "status" | "text" | "verdict" | "error" | "invocationId" | "citations">[]).map((s) => ({
                ...s,
                status: "pending",
                text: "",
                verdict: null,
                error: null,
                invocationId: null,
                citations: [],
              })),
            };
            const placeholderId = assistantId;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId ? { ...m, id: newId, run, warnings: d.warnings as string[] } : m.id === tempUser ? { ...m, id: d.userMessageId as string } : m,
              ),
            );
            assistantId = newId;
            break;
          }
          case "step-start":
            patchStep(assistantId, d.stepId as string, () => ({ status: "running", invocationId: d.invocationId as string }));
            break;
          case "step-delta":
            patchStep(assistantId, d.stepId as string, (s) => ({ status: "running", text: s.text + (d.text as string), handoff: null, approval: null }));
            break;
          case "step-done":
            patchStep(assistantId, d.stepId as string, (s) => ({
              handoff: null,
              approval: null,
              status: d.status as UIStep["status"],
              text: (d.text as string) || s.text,
              verdict: d.verdict as string | null,
              citations: (d.citations as UIStep["citations"]) ?? [],
              error: d.error as string | null,
            }));
            break;

          case "done":
            patch(assistantId, (m) =>
              m.run
                ? { status: d.status === "complete" ? "complete" : (d.status as UIMessage["status"]), content: (d.content as string) ?? "", run: { ...m.run, status: d.status as UIRun["status"] } }
                : {
                    status: "complete",
                    content: (d.text as string) || m.content,
                    stats: m.stats && {
                      ...m.stats,
                      citations: d.citations as MessageStats["citations"],
                      modelReported: d.modelReported as string | null,
                      inputTokens: d.inputTokens as number | null,
                      outputTokens: d.outputTokens as number | null,
                      latencyMs: d.latencyMs as number,
                      finishReason: d.finishReason as string,
                    },
                  },
            );
            break;
          case "error":
            patch(assistantId, () => ({ status: "error", approval: null, handoff: null }));
            setError((d.message as string) ?? "Er ging iets mis.");
            break;
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        patch(assistantId, (m) => ({ status: "cancelled", run: m.run && { ...m.run, status: "cancelled" } }));
      } else {
        setError(err instanceof Error ? err.message : "Er ging iets mis.");
        setMessages((prev) => prev.filter((m) => !(m.id === assistantId && !m.content && !m.run)));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      router.refresh(); // sidebar title / ordering
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2">
          <h1 className="truncate text-sm font-medium">{props.title}</h1>
          <div className="flex shrink-0 gap-2">
            <a
              href={`/report/${props.projectId}/${props.conversationId}`}
              className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
              title="Net rapport met vragen, antwoorden, controles en bronnen — af te drukken of op te slaan als PDF"
            >
              Rapport (PDF)
            </a>
            <a
              href={`/api/v1/projects/${props.projectId}/conversations/${props.conversationId}/export`}
              className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              Exporteren (.md)
            </a>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-5xl space-y-6">
            {messages.length === 0 && <EmptyState />}
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                modelLabel={m.stats?.modelId ? modelsById.get(m.stats.modelId)?.label : undefined}
                onProvenance={setProvenanceId}
                actions={props.canWrite && !busy ? { secondOpinion, saveKnowledge } : undefined}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t border-slate-200 bg-white p-3">
          <div className="mx-auto max-w-5xl">
            {error && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            {props.canWrite ? (
              <Composer
                projectId={props.projectId}
                models={props.models}
                projectDefaultModelId={props.projectDefaultModelId}
                busy={busy}
                onSend={(p) => void send(p)}
                onStop={() => abortRef.current?.abort()}
              />
            ) : (
              <p className="text-center text-sm text-slate-500">Je hebt leesrechten in dit project.</p>
            )}
          </div>
        </div>
      </div>
      {provenanceId && <ProvenancePanel projectId={props.projectId} invocationId={provenanceId} onClose={() => setProvenanceId(null)} />}
    </div>
  );
}

function EmptyState() {
  const items = [
    ["Chat", "Stel een vraag. Op 'Automatisch' kiest de router het model dat het best bij je vraag past, en laat zien waarom."],
    ["Vergelijk", "Stel dezelfde vraag aan meerdere AI's tegelijk en zie waar ze het eens en oneens zijn."],
    ["Diep onderzoek", "Perplexity zoekt bronnen, een tweede model werkt uit, een derde controleert, Gemini checkt de feiten, en alles wordt samengevoegd tot één eindantwoord."],
  ];
  return (
    <div className="mx-auto max-w-2xl py-10">
      <h2 className="mb-4 text-center text-base font-semibold text-slate-700">Waar kan ik mee helpen?</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map(([t, d]) => (
          <div key={t} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <p className="font-medium text-slate-800">{t}</p>
            <p className="mt-1 text-xs text-slate-500">{d}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-slate-400">Projectcontext en bestanden die &quot;in context&quot; staan gaan automatisch mee.</p>
    </div>
  );
}

interface BubbleActions {
  secondOpinion: (m: UIMessage) => void;
  saveKnowledge: (m: UIMessage) => Promise<void>;
}

function AnswerActions({ message, actions }: { message: UIMessage; actions?: BubbleActions }) {
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  if (!actions || message.status !== "complete" || !message.content) return null;
  return (
    <>
      <button onClick={() => actions.secondOpinion(message)} className="text-indigo-600 hover:underline" title="Laat een andere tool dit antwoord kritisch beoordelen">
        🔍 Tweede mening
      </button>
      <button
        disabled={saved !== "idle" && saved !== "error"}
        onClick={async () => {
          setSaved("saving");
          try {
            await actions.saveKnowledge(message);
            setSaved("saved");
          } catch {
            setSaved("error");
          }
        }}
        className="text-indigo-600 hover:underline disabled:text-emerald-700 disabled:no-underline"
        title="Zet dit antwoord in de projectdocumenten, zodat het in volgende gesprekken wordt meegenomen"
      >
        {saved === "saved" ? "📌 Bewaard in projectkennis ✓" : saved === "saving" ? "Bewaren…" : saved === "error" ? "Bewaren mislukt — opnieuw" : "📌 Bewaar als kennis"}
      </button>
    </>
  );
}

function MessageBubble({
  message: m,
  modelLabel,
  onProvenance,
  actions,
}: {
  message: UIMessage;
  modelLabel?: string;
  onProvenance: (id: string) => void;
  actions?: BubbleActions;
}) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-white">{m.content}</div>
      </div>
    );
  }
  const warnings = m.warnings?.map((w) => (
    <p key={w} className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
      ⚠ {w}
    </p>
  ));
  if (m.run) {
    return (
      <div className="space-y-1.5">
        {warnings}
        <RunCard run={m.run} content={m.content} onProvenance={onProvenance} />
        {m.status === "cancelled" && <p className="text-xs text-slate-500">— afgebroken</p>}
        <div className="flex flex-wrap gap-x-3 px-1 text-xs">
          <AnswerActions message={m} actions={actions} />
        </div>
      </div>
    );
  }
  const s = m.stats;
  const verdict = m.status === "complete" ? parseVerdict(m.content, "OORDEEL") : null;
  return (
    <div className="max-w-3xl space-y-1.5">
      {warnings}
      {verdict && VERDICT_BADGES[verdict] && (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${VERDICT_BADGES[verdict][1]}`}>{VERDICT_BADGES[verdict][0]}</span>
      )}
      <div className="rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-2 shadow-sm">
        {m.approval && !m.content && m.status === "streaming" ? (
          <ApprovalCard approval={m.approval} />
        ) : m.handoff && !m.content && m.status === "streaming" ? (
          <HandoffCard handoff={m.handoff} />
        ) : m.content ? (
          <Markdown>{m.content}</Markdown>
        ) : (
          <span className="animate-pulse text-sm text-slate-400">Denkt na…</span>
        )}
        {m.status === "cancelled" && <p className="mt-2 text-xs text-slate-500">— overgeslagen of geannuleerd</p>}
        {m.status === "error" && <p className="mt-2 text-xs text-rose-600">— fout tijdens genereren</p>}
        {s?.finishReason && FINISH_LABELS[s.finishReason] && <p className="mt-2 text-xs text-amber-700">⚠ {FINISH_LABELS[s.finishReason]}</p>}
      </div>
      {!!s?.citations?.length && <Sources citations={s.citations} />}
      {s && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-slate-500">
          <span className="font-medium text-slate-600">{modelLabel ?? s.modelId}</span>
          {s.modelReported && <span>versie {s.modelReported}</span>}
          {s.routing && (
            <span title={s.routing.reason} className={s.routing.strategy === "auto" ? "text-indigo-600" : undefined}>
              {ROUTING_LABELS[s.routing.strategy] ?? s.routing.strategy}
              {s.routing.strategy === "auto" ? `: ${s.routing.reason.split("→")[0]?.trim()}` : ""}
            </span>
          )}
          {s.inputTokens != null && (
            <span>
              {s.inputTokens.toLocaleString("nl-NL")} in / {s.outputTokens?.toLocaleString("nl-NL")} uit
            </span>
          )}
          {s.latencyMs != null && <span>{(s.latencyMs / 1000).toFixed(1)} s</span>}
          {!!s.redactions && <span className="text-emerald-700">{s.redactions} persoonsgegeven(s) gemaskeerd</span>}
          {m.content && <CopyButton text={m.content} />}
          <button onClick={() => onProvenance(s.invocationId)} className="text-indigo-600 hover:underline">
            Provenance
          </button>
          <AnswerActions message={m} actions={actions} />
        </div>
      )}
    </div>
  );
}
