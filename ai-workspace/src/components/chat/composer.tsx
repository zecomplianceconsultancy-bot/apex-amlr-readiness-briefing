"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClientModel } from "@/server/ai/catalog";
import { Button } from "@/components/ui";
import {
  applyPreset,
  bestFor,
  classifyTask,
  RESEARCH_PRESETS,
  suggestCompareTeam,
  suggestResearchTeam,
  TASK_LABELS,
  type ResearchAssignment,
  type ResearchPreset,
  type Role,
} from "@/lib/strengths";
import { PromptLibrary } from "./prompt-library";

export type Mode = "chat" | "compare" | "research";

export type SendPayload =
  | { mode: "chat"; text: string; modelId: string | null }
  | { mode: "compare"; text: string; modelIds: string[]; judgeModelId: string | null }
  | ({ mode: "research"; text: string } & ResearchAssignment);

interface Props {
  projectId: string;
  models: ClientModel[];
  projectDefaultModelId: string | null;
  busy: boolean;
  onSend: (p: SendPayload) => void;
  onStop: () => void;
}

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "chat", label: "Chat", hint: "Eén model; bij 'Automatisch' kiest de router het model dat het best past bij je vraag." },
  { id: "compare", label: "Vergelijk", hint: "Dezelfde vraag aan meerdere modellen tegelijk, plus een analyse van consensus en verschillen." },
  { id: "research", label: "Diep onderzoek", hint: "Onderzoek met bronnen → uitwerking → onafhankelijke controle → feitencheck → eindantwoord." },
];

const RESEARCH_ROLES: { key: keyof ResearchAssignment; label: string; optional?: boolean }[] = [
  { key: "research", label: "1. Onderzoek" },
  { key: "draft", label: "2. Uitwerking" },
  { key: "review", label: "3. Controle", optional: true },
  { key: "factcheck", label: "4. Feitencheck", optional: true },
  { key: "final", label: "5. Eindredactie", optional: true },
];

interface Saved {
  mode: Mode;
  chatModel: string;
  compare: string[];
  judge: string;
  research: ResearchAssignment | null;
}

const storageKey = (projectId: string) => `aiw:composer:${projectId}`;
function load(projectId: string): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(projectId)) ?? "{}") as Partial<Saved>;
  } catch {
    return {};
  }
}

function ModelSelect({
  models,
  value,
  onChange,
  allowEmpty,
  emptyLabel,
  className = "",
}: {
  models: ClientModel[];
  value: string;
  onChange: (v: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  const groups: [string, ClientModel[]][] = [
    ["Via browser (automatisch)", models.filter((m) => m.transport === "browser")],
    ["Handmatig (jij plakt het antwoord)", models.filter((m) => m.transport === "manual")],
    ["Via API", models.filter((m) => m.transport === "api")],
    ["Lokaal / test", models.filter((m) => m.transport === "local")],
  ];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-md border border-slate-300 bg-white px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none ${className}`}
    >
      {allowEmpty && <option value="">{emptyLabel ?? "—"}</option>}
      {groups.map(([label, items]) =>
        items.length ? (
          <optgroup key={label} label={label}>
            {items.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available} title={m.available ? m.strengths : (m.reason ?? "")}>
                {m.label}
                {m.available ? ` — ${m.strengths}` : " (niet beschikbaar)"}
              </option>
            ))}
          </optgroup>
        ) : null,
      )}
    </select>
  );
}

export function Composer({ projectId, models, projectDefaultModelId, busy, onSend, onStop }: Props) {
  const rankable = useMemo(() => models.map((m) => ({ id: m.id, tags: m.tags, available: m.available })), [models]);
  const available = useMemo(() => new Set(models.filter((m) => m.available).map((m) => m.id)), [models]);
  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models]);

  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("chat");
  const [chatModel, setChatModel] = useState("");
  const [compare, setCompare] = useState<string[]>(() => suggestCompareTeam(rankable).modelIds);
  const [judge, setJudge] = useState<string>(() => suggestCompareTeam(rankable).judge ?? "");
  const [research, setResearch] = useState<ResearchAssignment | null>(() => suggestResearchTeam(rankable));

  // Restore the last used settings for this project (only models that are still available).
  useEffect(() => {
    const saved = load(projectId);
    if (saved.mode) setMode(saved.mode);
    if (saved.chatModel === "" || (saved.chatModel && available.has(saved.chatModel))) setChatModel(saved.chatModel);
    if (saved.compare?.every((id) => available.has(id)) && saved.compare.length >= 2) setCompare(saved.compare);
    if (saved.judge === "" || (saved.judge && available.has(saved.judge))) setJudge(saved.judge);
    if (saved.research && Object.values(saved.research).every((v) => v === null || available.has(v))) setResearch(saved.research);
  }, [projectId, available]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(projectId), JSON.stringify({ mode, chatModel, compare, judge, research } satisfies Saved));
    } catch {
      // storage unavailable; settings just won't persist
    }
  }, [projectId, mode, chatModel, compare, judge, research]);

  const problems: string[] = [];
  if (mode === "compare" && compare.length < 2) problems.push("Kies minimaal 2 modellen.");
  if (mode === "research" && !research) problems.push("Geen beschikbare modellen voor diep onderzoek.");
  if (mode === "research" && research?.review && research.review === research.draft)
    problems.push("Tip: laat de controle door een ander model doen dan de uitwerking, voor een onafhankelijk oordeel.");
  const blocking = problems.filter((p) => !p.startsWith("Tip"));

  // Live advice while typing: which engine fits this question best (same rules as the router).
  const advice = useMemo(() => {
    if (mode !== "chat" || chatModel || projectDefaultModelId || text.trim().length < 8) return null;
    const { role, reason } = classifyTask(text);
    const id = bestFor(role, rankable);
    const model = id ? byId.get(id) : undefined;
    return model ? { model, reason } : null;
  }, [mode, chatModel, projectDefaultModelId, text, rankable, byId]);

  const usePreset = (preset: ResearchPreset) => {
    const suggested = suggestResearchTeam(rankable);
    if (!suggested) return;
    // Keep the user's own choices where set; fill the rest from the strength-based team.
    const current = research ?? suggested;
    const base: ResearchAssignment = {
      research: current.research,
      draft: current.draft,
      review: current.review ?? suggested.review,
      factcheck: current.factcheck ?? suggested.factcheck,
      final: current.final ?? suggested.final,
    };
    setResearch(applyPreset(base, preset));
  };

  function send() {
    const t = text.trim();
    if (!t || busy || blocking.length) return;
    if (mode === "chat") onSend({ mode, text: t, modelId: chatModel || null });
    else if (mode === "compare") onSend({ mode, text: t, modelIds: compare, judgeModelId: judge || null });
    else if (research) onSend({ mode, text: t, ...research });
    setText("");
  }

  const defaultLabel = projectDefaultModelId ? byId.get(projectDefaultModelId)?.label : undefined;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              title={m.hint}
              onClick={() => setMode(m.id)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${mode === m.id ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === "chat" && (
          <ModelSelect
            models={models}
            value={chatModel}
            onChange={setChatModel}
            allowEmpty
            emptyLabel={defaultLabel ? `Projectstandaard (${defaultLabel})` : "Automatisch — beste model voor je vraag"}
            className="max-w-xs"
          />
        )}

        {mode === "compare" && (
          <div className="flex flex-wrap items-center gap-1.5">
            {models
              .filter((m) => m.available)
              .map((m) => {
                const on = compare.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    title={m.strengths}
                    onClick={() => setCompare((c) => (on ? c.filter((x) => x !== m.id) : c.length >= 4 ? c : [...c, m.id]))}
                    className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${on ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-600 ring-slate-300 hover:ring-slate-400"}`}
                  >
                    {m.label}
                  </button>
                );
              })}
            <span className="ml-1 text-xs text-slate-500">Analyse door</span>
            <ModelSelect models={models} value={judge} onChange={setJudge} allowEmpty emptyLabel="geen analyse" className="max-w-[12rem]" />
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <ToolGuide models={models} rankable={rankable} />
          <PromptLibrary projectId={projectId} currentText={text} onInsert={(body) => setText((t) => (t.trim() ? `${t}\n\n${body}` : body))} />
        </div>
      </div>

      {mode === "research" && research && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-slate-50 px-2 py-1.5">
          {RESEARCH_ROLES.map((r) => (
            <label key={r.key} className="flex items-center gap-1 text-xs text-slate-600">
              {r.label}
              <ModelSelect
                models={models}
                value={research[r.key] ?? ""}
                onChange={(v) => setResearch({ ...research, [r.key]: r.optional ? v || null : v })}
                allowEmpty={r.optional}
                emptyLabel="overslaan"
                className="max-w-[9.5rem]"
              />
            </label>
          ))}
          <span className="flex items-center gap-1 text-xs text-slate-500">
            {(Object.keys(RESEARCH_PRESETS) as ResearchPreset[]).map((p) => (
              <button key={p} type="button" onClick={() => usePreset(p)} className="rounded-full px-2 py-0.5 ring-1 ring-slate-300 hover:bg-white">
                {RESEARCH_PRESETS[p].label}
              </button>
            ))}
          </span>
          <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => setResearch(suggestResearchTeam(rankable))}>
            Op sterke punten verdelen
          </button>
        </div>
      )}

      {problems.length > 0 && <p className={`text-xs ${blocking.length ? "text-rose-600" : "text-amber-700"}`}>{problems.join(" ")}</p>}
      {advice && (
        <p className="text-xs text-slate-600">
          <span className="font-medium text-indigo-700">Advies: {advice.model.label}</span> — {advice.model.strengths}
          <span className="text-slate-400"> ({advice.reason.toLowerCase()})</span>
          <button type="button" className="ml-2 text-indigo-600 hover:underline" onClick={() => setChatModel(advice.model.id)}>
            vastzetten
          </button>
        </p>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={Math.min(10, Math.max(2, text.split("\n").length))}
          placeholder={
            mode === "chat"
              ? "Typ je bericht… (Enter = versturen, Shift+Enter = nieuwe regel)"
              : mode === "compare"
                ? "Vraag voor alle gekozen modellen…"
                : "Onderzoeksvraag… (de keten kan enkele minuten duren)"
          }
          className="min-h-0 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        />
        {busy ? (
          <Button variant="secondary" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button onClick={send} disabled={!text.trim() || blocking.length > 0}>
            {mode === "chat" ? "Verstuur" : mode === "compare" ? "Vergelijk" : "Start onderzoek"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** "Which tool for what": the best available engine per kind of task, from the strength profiles. */
function ToolGuide({ models, rankable }: { models: ClientModel[]; rankable: { id: string; tags: readonly string[]; available: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const byId = new Map(models.map((m) => [m.id, m]));
  const rows = (Object.entries(TASK_LABELS) as [Role, string][]).map(([role, label]) => {
    const id = bestFor(role, rankable);
    return { label, model: id ? byId.get(id) : undefined };
  });
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
        Welke tool? ▾
      </button>
      {open && (
        <div className="absolute right-0 bottom-9 z-20 w-[26rem] rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Welke tool waarvoor</p>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="py-1.5 pr-2 text-slate-600">{r.label}</td>
                  <td className="py-1.5 font-medium text-slate-800">{r.model?.label ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-400">Op &quot;Automatisch&quot; volgt de workspace dit advies zelf. Je ziet het advies ook terwijl je typt.</p>
        </div>
      )}
    </div>
  );
}
