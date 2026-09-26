"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";

export interface UIHandoff {
  handoffId: string;
  tool: string;
  toolLabel: string;
  prompt: string;
  openUrl: string;
  prefilled: boolean;
}

/**
 * Manual bridge: the user sends the prepared question in the tool's own website (normal
 * browser, no automation) and pastes the answer back here.
 */
export function HandoffCard({ handoff }: { handoff: UIHandoff }) {
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(handoff.prompt);
      setCopied(true);
    } catch {
      setError("Kopiëren lukte niet; selecteer de vraag hieronder en kopieer met Ctrl+C.");
    }
  };

  async function submit(body: { text: string } | { cancel: true }) {
    setState("sending");
    setError(null);
    try {
      await api(`/api/v1/handoffs/${handoff.handoffId}`, { method: "POST", json: body });
      setState("sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Versturen mislukt.");
      setState("idle");
    }
  }

  if (state === "sent") return <p className="text-sm text-slate-500">Antwoord ontvangen, verwerken…</p>;

  return (
    <div className="space-y-2 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-3 text-sm">
      <p className="font-medium text-amber-900">Handmatige stap: {handoff.toolLabel}</p>
      <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-700">
        <li>
          Klik op <b>Kopieer vraag en open {handoff.toolLabel}</b>. {handoff.prefilled ? "De vraag staat daar al klaar; controleer en verstuur." : "Plak de vraag daar met Ctrl+V en verstuur."}
        </li>
        <li>Wacht tot het antwoord klaar is en kopieer het volledige antwoord (met de bronnen).</li>
        <li>Plak het hieronder en klik op Verwerken.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            await copy();
            window.open(handoff.openUrl, "_blank", "noopener,noreferrer");
          }}
          className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white"
        >
          Kopieer vraag en open {handoff.toolLabel}
        </button>
        <a href={handoff.openUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-700 underline">
          Alleen openen
        </a>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-slate-600">Vraag bekijken / kopiëren {copied && <span className="text-emerald-700">(gekopieerd ✓)</span>}</summary>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px]">{handoff.prompt}</pre>
        <button type="button" onClick={() => void copy()} className="mt-1 text-indigo-700 hover:underline">
          Kopieer vraag
        </button>
      </details>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={5}
        placeholder={`Plak hier het antwoord van ${handoff.toolLabel}…`}
        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
      />
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!answer.trim() || state === "sending"}
          onClick={() => void submit({ text: answer })}
          className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          Verwerken
        </button>
        <button type="button" onClick={() => void submit({ cancel: true })} className="rounded-lg px-3 py-1 text-xs text-slate-600 ring-1 ring-slate-300">
          Overslaan
        </button>
      </div>
    </div>
  );
}
