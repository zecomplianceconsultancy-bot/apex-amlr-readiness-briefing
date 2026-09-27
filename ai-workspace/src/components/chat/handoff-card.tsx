"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";

export interface UIHandoff {
  handoffId: string;
  tool: string;
  toolLabel: string;
  prompt: string;
  openUrl: string;
  prefilled: boolean;
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Manual bridge in two clicks: (1) copy the question and open the tool in the user's own
 * browser, (2) after copying the answer there, paste-and-process it here.
 */
export function HandoffCard({ handoff }: { handoff: UIHandoff }) {
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [opened, setOpened] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (showManual) textareaRef.current?.focus();
  }, [showManual]);

  async function submit(body: { text: string } | { cancel: true }) {
    if ("text" in body) {
      // Guard against the most common slip: pasting the question instead of the answer.
      if (normalize(body.text) === normalize(handoff.prompt)) {
        setError(`Dit is de vraag, niet het antwoord. Kopieer eerst het antwoord in ${handoff.toolLabel}.`);
        return;
      }
    }
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

  async function copyAndOpen() {
    setError(null);
    try {
      await navigator.clipboard.writeText(handoff.prompt);
    } catch {
      setShowManual(true);
      setError("Kopiëren lukte niet automatisch. Kopieer de vraag hieronder zelf (Ctrl+C).");
    }
    window.open(handoff.openUrl, "_blank", "noopener,noreferrer");
    setOpened(true);
  }

  async function pasteAndProcess() {
    setError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setError(`Je klembord is leeg. Kopieer eerst het antwoord in ${handoff.toolLabel}.`);
        return;
      }
      await submit({ text });
    } catch {
      // Clipboard read refused or unsupported: fall back to pasting in the text box.
      setShowManual(true);
      setError("De browser gaf geen toegang tot het klembord. Plak het antwoord hieronder met Ctrl+V.");
    }
  }

  if (state === "sent") return <p className="text-sm text-slate-500">Antwoord ontvangen, verwerken…</p>;

  const step = "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium";
  return (
    <div className="space-y-2 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 p-3 text-sm">
      <p className="font-medium text-amber-900">Handmatige stap: {handoff.toolLabel}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void copyAndOpen()} className={`${step} ${opened ? "bg-white text-slate-600 ring-1 ring-slate-300" : "bg-amber-600 text-white"}`}>
          <span className="rounded-full bg-white/30 px-1.5">1</span> Kopieer vraag &amp; open {handoff.toolLabel}
          {opened && " ✓"}
        </button>
        <button
          type="button"
          disabled={state === "sending"}
          onClick={() => void pasteAndProcess()}
          className={`${step} ${opened ? "bg-indigo-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-300"}`}
        >
          <span className="rounded-full bg-white/30 px-1.5">2</span> Plak antwoord &amp; verwerk
        </button>
        <button type="button" onClick={() => void submit({ cancel: true })} className="text-xs text-slate-500 hover:text-slate-800">
          Overslaan
        </button>
      </div>
      <p className="text-xs text-slate-600">
        {handoff.prefilled ? `De vraag staat in ${handoff.toolLabel} al klaar; verstuur hem daar.` : `Plak de vraag in ${handoff.toolLabel} met Ctrl+V en verstuur.`}{" "}
        Kopieer daarna het hele antwoord (met bronnen) en klik op 2.
      </p>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex gap-3 text-xs">
        <button type="button" className="text-indigo-700 hover:underline" onClick={() => setShowManual((v) => !v)}>
          {showManual ? "Verberg" : "Vraag bekijken / zelf plakken"}
        </button>
      </div>
      {showManual && (
        <div className="space-y-2">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px]">{handoff.prompt}</pre>
          <textarea
            ref={textareaRef}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && answer.trim()) void submit({ text: answer });
            }}
            rows={5}
            placeholder={`Plak hier het antwoord van ${handoff.toolLabel}… (Ctrl+Enter = verwerken)`}
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="button"
            disabled={!answer.trim() || state === "sending"}
            onClick={() => void submit({ text: answer })}
            className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
          >
            Verwerken
          </button>
        </div>
      )}
    </div>
  );
}
