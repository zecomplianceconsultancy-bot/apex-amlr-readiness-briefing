"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

interface Invocation {
  id: string;
  purpose: string;
  provider: string;
  modelId: string;
  modelRequested: string;
  modelReported: string | null;
  status: string;
  routing: { strategy: string; reason: string };
  params: Record<string, unknown>;
  requestPayload: { system?: string | null; messages?: { role: string; content: string }[] } & Record<string, unknown>;
  requestHash: string;
  contextRefs: {
    projectContext?: { version: number } | null;
    files?: { filename: string; sha256: string; chars: number; truncated: boolean }[];
    excludedFiles?: { filename: string; reason: string }[];
    history?: { messages: number; droppedOldest: number };
  };
  policy: { egress?: { allowed: boolean; projectClassification: string; modelClearance: string }; piiRedaction?: boolean; redaction?: { total: number; byType: Record<string, number> } };
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  providerRequestId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  userName: string;
}

/** Everything needed to answer "which model produced this, with what input, under which policy?" */
export function ProvenancePanel({ projectId, invocationId, onClose }: { projectId: string; invocationId: string; onClose: () => void }) {
  const [inv, setInv] = useState<Invocation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInv(null);
    api<{ invocation: Invocation }>(`/api/v1/projects/${projectId}/invocations/${invocationId}`)
      .then((r) => setInv(r.invocation))
      .catch((e: Error) => setError(e.message));
  }, [projectId, invocationId]);

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <h2 className="text-sm font-semibold">Provenance</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Sluiten">
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        {error && <p className="text-rose-600">{error}</p>}
        {!inv && !error && <p className="text-slate-400">Laden…</p>}
        {inv && (
          <>
            <Section title="Model">
              <Row k="Provider" v={inv.provider} />
              <Row k="Model (registry)" v={inv.modelId} />
              <Row k="Aangevraagd" v={inv.modelRequested} />
              <Row k="Gerapporteerde versie" v={inv.modelReported ?? "—"} />
              <Row k="Routing" v={`${inv.routing.strategy} — ${inv.routing.reason}`} />
            </Section>
            <Section title="Uitvoering">
              <Row k="Status" v={inv.status} />
              <Row k="Gebruiker" v={inv.userName} />
              <Row k="Gestart" v={formatDateTime(inv.startedAt)} />
              <Row k="Latency" v={inv.latencyMs != null ? `${inv.latencyMs} ms` : "—"} />
              <Row k="Tokens in / uit" v={`${inv.inputTokens ?? "—"} / ${inv.outputTokens ?? "—"}`} />
              <Row k="Finish reason" v={inv.finishReason ?? "—"} />
              <Row k="Provider request id" v={inv.providerRequestId ?? "—"} mono />
              {inv.errorCode && <Row k="Fout" v={`${inv.errorCode}: ${inv.errorMessage ?? ""}`} />}
            </Section>
            <Section title="Datapolicy">
              <Row k="Projectclassificatie" v={inv.policy.egress?.projectClassification ?? "—"} />
              <Row k="Modelclearance" v={inv.policy.egress?.modelClearance ?? "—"} />
              <Row k="Toegestaan" v={inv.policy.egress?.allowed ? "ja" : "nee"} />
              <Row k="PII-masking" v={inv.policy.piiRedaction ? "aan" : "uit"} />
              <Row
                k="Gemaskeerd"
                v={
                  inv.policy.redaction?.total
                    ? Object.entries(inv.policy.redaction.byType)
                        .map(([t, n]) => `${t} ×${n}`)
                        .join(", ")
                    : "niets"
                }
              />
            </Section>
            <Section title="Context">
              <Row k="Projectcontext" v={inv.contextRefs.projectContext ? `versie ${inv.contextRefs.projectContext.version}` : "geen"} />
              <Row k="Geschiedenis" v={`${inv.contextRefs.history?.messages ?? 0} berichten${inv.contextRefs.history?.droppedOldest ? `, ${inv.contextRefs.history.droppedOldest} weggelaten` : ""}`} />
              {(inv.contextRefs.files ?? []).map((f) => (
                <Row key={f.sha256} k={f.filename} v={`${f.chars} tekens${f.truncated ? " (ingekort)" : ""} · sha256 ${f.sha256.slice(0, 12)}…`} />
              ))}
              {(inv.contextRefs.excludedFiles ?? []).map((f) => (
                <Row key={f.filename} k={f.filename} v={`niet meegestuurd: ${f.reason}`} />
              ))}
              <Row k="Request hash" v={inv.requestHash} mono />
            </Section>
            <details className="rounded-lg border border-slate-200">
              <summary className="cursor-pointer px-3 py-2 font-medium">Exact verzonden payload</summary>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words bg-slate-50 p-3 text-[11px]">{JSON.stringify(inv.requestPayload, null, 2)}</pre>
            </details>
          </>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <dl className="space-y-1">{children}</dl>
    </section>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2">
      <dt className="text-slate-500">{k}</dt>
      <dd className={`break-all text-slate-800 ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}
