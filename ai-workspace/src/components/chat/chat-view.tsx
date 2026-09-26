"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ClientModel } from "@/server/ai/catalog";
import { readSse, toApiError } from "@/lib/api-client";
import { Button, Select } from "@/components/ui";
import { ProvenancePanel } from "./provenance-panel";
import type { MessageStats, UIMessage } from "./types";

interface Props {
  projectId: string;
  conversationId: string;
  title: string;
  canWrite: boolean;
  projectDefaultModelId: string | null;
  models: ClientModel[];
  initialMessages: UIMessage[];
}

const MODEL_GROUPS = [
  { transport: "browser", label: "Via browser (desktop)" },
  { transport: "api", label: "Via API" },
  { transport: "local", label: "Lokaal / test" },
] as const;

const FINISH_LABELS: Record<string, string> = {
  length: "Afgekapt: maximale lengte bereikt",
  refusal: "Het model weigerde dit verzoek",
  content_filter: "Geblokkeerd door contentfilter van de provider",
};

export function ChatView(props: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<UIMessage[]>(props.initialMessages);
  const [input, setInput] = useState("");
  const [modelId, setModelId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [provenanceId, setProvenanceId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const modelsById = useMemo(() => new Map(props.models.map((m) => [m.id, m])), [props.models]);
  const defaultLabel = props.projectDefaultModelId ? modelsById.get(props.projectDefaultModelId)?.label : undefined;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const patchAssistant = (id: string, patch: (m: UIMessage) => Partial<UIMessage>) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch(m) } : m)));

  async function send() {
    const content = input.trim();
    if (!content || streaming) return;
    setError(null);
    setInput("");
    setStreaming(true);
    const tempUser = `tmp-user-${Date.now()}`;
    let assistantId = `tmp-assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempUser, role: "user", content, status: "complete" },
      { id: assistantId, role: "assistant", content: "", status: "streaming" },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/v1/projects/${props.projectId}/conversations/${props.conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, modelId: modelId || null }),
        signal: controller.signal,
      });
      if (!res.ok) throw await toApiError(res);

      for await (const { event, data } of readSse(res)) {
        const d = data as Record<string, unknown>;
        if (event === "meta") {
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
        } else if (event === "delta") {
          patchAssistant(assistantId, (m) => ({ content: m.content + (d.text as string) }));
        } else if (event === "done") {
          patchAssistant(assistantId, (m) => ({
            status: "complete",
            content: (d.text as string) || m.content,
            stats: m.stats && {
              citations: d.citations as MessageStats["citations"],
              ...m.stats,
              modelReported: d.modelReported as string | null,
              inputTokens: d.inputTokens as number | null,
              outputTokens: d.outputTokens as number | null,
              latencyMs: d.latencyMs as number,
              finishReason: d.finishReason as string,
            },
          }));
        } else if (event === "error") {
          patchAssistant(assistantId, () => ({ status: "error" }));
          setError((d.message as string) ?? "Er ging iets mis.");
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        patchAssistant(assistantId, () => ({ status: "cancelled" }));
      } else {
        setError(err instanceof Error ? err.message : "Er ging iets mis.");
        setMessages((prev) => prev.filter((m) => !(m.id === assistantId && !m.content)));
      }
    } finally {
      abortRef.current = null;
      setStreaming(false);
      router.refresh(); // sidebar title / ordering
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2">
          <h1 className="truncate text-sm font-medium">{props.title}</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Model</span>
            <Select value={modelId} onChange={(e) => setModelId(e.target.value)} className="w-64 py-1" disabled={streaming}>
              <option value="">Automatisch{defaultLabel ? ` (${defaultLabel})` : " (router)"}</option>
              {MODEL_GROUPS.map((group) => {
                const items = props.models.filter((m) => m.transport === group.transport);
                if (!items.length) return null;
                return (
                  <optgroup key={group.transport} label={group.label}>
                    {items.map((m) => (
                      <option key={m.id} value={m.id} disabled={!m.available} title={m.reason ?? m.description}>
                        {m.label}
                        {!m.available ? " — niet beschikbaar" : ""}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </Select>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.length === 0 && (
              <p className="py-16 text-center text-sm text-slate-400">Stel een vraag. Projectcontext en geselecteerde bestanden worden automatisch meegestuurd.</p>
            )}
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} modelLabel={m.stats?.modelId ? modelsById.get(m.stats.modelId)?.label : undefined} onProvenance={setProvenanceId} />
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="border-t border-slate-200 bg-white p-3">
          <div className="mx-auto max-w-3xl">
            {error && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            {props.canWrite ? (
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={Math.min(8, Math.max(2, input.split("\n").length))}
                  placeholder="Typ je bericht… (Enter = versturen, Shift+Enter = nieuwe regel)"
                  className="min-h-0 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
                {streaming ? (
                  <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
                    Stop
                  </Button>
                ) : (
                  <Button onClick={() => void send()} disabled={!input.trim()}>
                    Verstuur
                  </Button>
                )}
              </div>
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

function MessageBubble({ message: m, modelLabel, onProvenance }: { message: UIMessage; modelLabel?: string; onProvenance: (id: string) => void }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-white">{m.content}</div>
      </div>
    );
  }
  const s = m.stats;
  return (
    <div className="space-y-1.5">
      {m.warnings?.map((w) => (
        <p key={w} className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
          ⚠ {w}
        </p>
      ))}
      <div className="prose-chat rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-2 text-sm leading-relaxed shadow-sm">
        {m.content ? <ReactMarkdown>{m.content}</ReactMarkdown> : <span className="animate-pulse text-slate-400">Denkt na…</span>}
        {m.status === "cancelled" && <p className="mt-2 text-xs text-slate-500">— geannuleerd</p>}
        {m.status === "error" && <p className="mt-2 text-xs text-rose-600">— fout tijdens genereren</p>}
        {s?.finishReason && FINISH_LABELS[s.finishReason] && <p className="mt-2 text-xs text-amber-700">⚠ {FINISH_LABELS[s.finishReason]}</p>}
      </div>
      {!!s?.citations?.length && (
        <details className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs">
          <summary className="cursor-pointer font-medium text-slate-600">Bronnen ({s.citations.length})</summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            {s.citations.map((c) => (
              <li key={c.url}>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="break-all text-indigo-600 hover:underline">
                  {c.title || c.url}
                </a>
              </li>
            ))}
          </ol>
        </details>
      )}
      {s && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-slate-500">
          <span className="font-medium text-slate-600">{modelLabel ?? s.modelId}</span>
          {s.modelReported && <span>versie {s.modelReported}</span>}
          {s.routing && <span title={s.routing.reason}>routing: {s.routing.strategy}</span>}
          {s.inputTokens != null && (
            <span>
              {s.inputTokens.toLocaleString("nl-NL")} in / {s.outputTokens?.toLocaleString("nl-NL")} uit
            </span>
          )}
          {s.latencyMs != null && <span>{(s.latencyMs / 1000).toFixed(1)} s</span>}
          {!!s.redactions && <span className="text-emerald-700">{s.redactions} persoonsgegeven(s) gemaskeerd</span>}
          <button onClick={() => onProvenance(s.invocationId)} className="text-indigo-600 hover:underline">
            Provenance
          </button>
        </div>
      )}
    </div>
  );
}
