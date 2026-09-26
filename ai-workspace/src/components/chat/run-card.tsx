"use client";

import { CopyButton } from "./copy-button";
import { Markdown } from "./markdown";
import { Sources, uniqueCitations } from "./sources";
import type { UIRun, UIStep } from "./types";

const ROLE_LABELS: Record<UIStep["role"], string> = {
  answer: "Antwoord",
  judge: "Vergelijkende analyse",
  research: "Onderzoek",
  draft: "Uitwerking",
  review: "Onafhankelijke controle",
  factcheck: "Feitencheck",
  final: "Eindantwoord",
};

const STATUS: Record<UIStep["status"], [string, string]> = {
  pending: ["Wacht", "bg-slate-100 text-slate-500"],
  running: ["Bezig…", "bg-indigo-50 text-indigo-700 animate-pulse"],
  complete: ["Klaar", "bg-emerald-50 text-emerald-700"],
  error: ["Fout", "bg-rose-50 text-rose-700"],
  cancelled: ["Afgebroken", "bg-slate-100 text-slate-600"],
  skipped: ["Overgeslagen", "bg-slate-100 text-slate-500"],
};

/** Verdict badges: green = fine, amber = attention, red = do not rely on this. */
const VERDICTS: Record<string, [string, string]> = {
  AKKOORD: ["Controleur: akkoord", "bg-emerald-100 text-emerald-800"],
  AANPASSEN: ["Controleur: aanpassen nodig", "bg-amber-100 text-amber-900"],
  ONBETROUWBAAR: ["Controleur: onbetrouwbaar", "bg-rose-100 text-rose-800"],
  CORRECT: ["Feiten: correct", "bg-emerald-100 text-emerald-800"],
  FOUTEN: ["Feiten: fouten gevonden", "bg-rose-100 text-rose-800"],
  ONZEKER: ["Feiten: deels onzeker", "bg-amber-100 text-amber-900"],
  HOOG: ["Overeenstemming: hoog", "bg-emerald-100 text-emerald-800"],
  MIDDEL: ["Overeenstemming: middel", "bg-amber-100 text-amber-900"],
  LAAG: ["Overeenstemming: laag — modellen zijn het oneens", "bg-rose-100 text-rose-800"],
};

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>{children}</span>;
}

function StepBody({ step, onProvenance }: { step: UIStep; onProvenance: (id: string) => void }) {
  return (
    <div className="space-y-2">
      {step.text ? <Markdown>{step.text}</Markdown> : step.status === "running" ? <p className="animate-pulse text-sm text-slate-400">Bezig…</p> : null}
      {step.error && <p className="text-xs text-rose-600">{step.error}</p>}
      <Sources citations={step.citations} />
      <div className="flex gap-3 text-xs">
        {step.text && <CopyButton text={step.text} />}
        {step.invocationId && (
          <button className="text-indigo-600 hover:underline" onClick={() => onProvenance(step.invocationId!)}>
            Provenance
          </button>
        )}
      </div>
    </div>
  );
}

function StepHeader({ step, index }: { step: UIStep; index?: number }) {
  const [label, style] = STATUS[step.status];
  const verdict = step.verdict ? VERDICTS[step.verdict] : undefined;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {index !== undefined && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-700">{index}</span>}
      <span className="text-sm font-medium">{ROLE_LABELS[step.role]}</span>
      <span className="text-xs text-slate-500">{step.label}</span>
      <Badge className={style}>{label}</Badge>
      {verdict && <Badge className={verdict[1]}>{verdict[0]}</Badge>}
    </div>
  );
}

export function RunCard({ run, content, onProvenance }: { run: UIRun; content: string; onProvenance: (id: string) => void }) {
  return run.kind === "compare" ? (
    <CompareView run={run} onProvenance={onProvenance} />
  ) : (
    <ResearchView run={run} content={content} onProvenance={onProvenance} />
  );
}

function CompareView({ run, onProvenance }: { run: UIRun; onProvenance: (id: string) => void }) {
  const answers = run.steps.filter((s) => s.role === "answer");
  const judge = run.steps.find((s) => s.role === "judge");
  const cols = answers.length >= 4 ? "xl:grid-cols-4 md:grid-cols-2" : answers.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2";
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Vergelijking · {answers.length} modellen</p>
      <div className={`grid grid-cols-1 gap-3 ${cols}`}>
        {answers.map((s) => (
          <div key={s.id} className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <StepHeader step={s} />
            <div className="mt-2 max-h-[28rem] min-h-0 overflow-y-auto">
              <StepBody step={s} onProvenance={onProvenance} />
            </div>
          </div>
        ))}
      </div>
      {judge && (
        <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/40 p-4">
          <StepHeader step={judge} />
          <div className="mt-2">
            <StepBody step={judge} onProvenance={onProvenance} />
          </div>
        </div>
      )}
    </div>
  );
}

function ResearchView({ run, content, onProvenance }: { run: UIRun; content: string; onProvenance: (id: string) => void }) {
  const steps = run.steps.filter((s) => s.role !== "final");
  const final = run.steps.find((s) => s.role === "final");
  const review = run.steps.find((s) => s.role === "review");
  const factcheck = run.steps.find((s) => s.role === "factcheck");
  const allSources = uniqueCitations(run.steps.map((s) => s.citations));
  const disagreement = (review?.verdict && review.verdict !== "AKKOORD") || factcheck?.verdict === "FOUTEN" || factcheck?.verdict === "ONZEKER";
  const finalText = final?.text || content;
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Diep onderzoek · {run.steps.length} stappen</p>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.id}>
            <details open={s.status === "running"} className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
              <summary className="cursor-pointer list-none">
                <StepHeader step={s} index={i + 1} />
              </summary>
              <div className="mt-2 max-h-[32rem] overflow-y-auto border-t border-slate-100 pt-2">
                <StepBody step={s} onProvenance={onProvenance} />
              </div>
            </details>
          </li>
        ))}
      </ol>
      {final && (
        <div className="rounded-xl border-2 border-emerald-200 bg-white p-4 shadow-sm">
          <StepHeader step={final} index={run.steps.length} />
          {disagreement && final.status === "complete" && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              ⚠ De controle{factcheck ? " of feitencheck" : ""} vond punten van aandacht. Het eindantwoord verwerkt die; resterende twijfels staan onder
              &quot;Openstaande punten&quot;. Lees bij twijfel de controlestappen hierboven.
            </p>
          )}
          <div className="mt-2">
            {finalText ? <Markdown>{finalText}</Markdown> : final.status === "running" ? <p className="animate-pulse text-sm text-slate-400">Bezig…</p> : null}
            {final.error && <p className="text-xs text-rose-600">{final.error}</p>}
          </div>
          <div className="mt-2 space-y-2">
            <Sources citations={allSources} open />
            <div className="flex gap-3 text-xs">
              {finalText && <CopyButton text={finalText} label="Kopieer eindantwoord" />}
              {final.invocationId && (
                <button className="text-indigo-600 hover:underline" onClick={() => onProvenance(final.invocationId!)}>
                  Provenance
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
