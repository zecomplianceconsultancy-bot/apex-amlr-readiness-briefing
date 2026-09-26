"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";

interface Prompt {
  id: string;
  title: string;
  body: string;
  projectId: string | null;
}

/** Ready-made prompts for common analysis work; always available. */
const STARTERS: { title: string; body: string }[] = [
  {
    title: "Samenvatting met bronnen",
    body: "Vat de projectdocumenten samen in maximaal 10 kernpunten. Vermeld bij elk punt uit welk document het komt. Sluit af met open vragen.",
  },
  {
    title: "Risicoanalyse",
    body: "Maak een risicoanalyse van het onderwerp hieronder. Geef per risico: omschrijving, oorzaak, impact (hoog/middel/laag), kans (hoog/middel/laag) en beheersmaatregel. Presenteer als tabel.\n\nOnderwerp: ",
  },
  {
    title: "Kritische review",
    body: "Beoordeel de onderstaande tekst kritisch als tweede lijn: feitelijke juistheid, volledigheid, tegenstrijdigheden en risico's. Geef concrete verbeterpunten.\n\nTekst:\n",
  },
  {
    title: "Wet- en regelgeving vergelijken",
    body: "Vergelijk de volgende regels of kaders. Geef een tabel met overeenkomsten, verschillen en praktische gevolgen, met verwijzing naar artikelen en bronnen.\n\nTe vergelijken: ",
  },
  {
    title: "Uitleg in eenvoudige taal",
    body: "Leg het volgende uit in eenvoudige taal (B1-niveau), met een concreet voorbeeld en de drie belangrijkste aandachtspunten:\n\n",
  },
];

export function PromptLibrary({ projectId, currentText, onInsert }: { projectId: string; currentText: string; onInsert: (body: string) => void }) {
  const [open, setOpen] = useState(false);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [title, setTitle] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    api<{ prompts: Prompt[] }>(`/api/v1/prompts?projectId=${projectId}`)
      .then((r) => setPrompts(r.prompts))
      .catch((e: Error) => setError(e.message));
  }, [projectId]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function save() {
    setError(null);
    try {
      await api("/api/v1/prompts", { method: "POST", json: { projectId, shared, title, body: currentText } });
      setTitle("");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt.");
    }
  }

  const pick = (body: string) => {
    onInsert(body);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
        Prompts ▾
      </button>
      {open && (
        <div className="absolute right-0 bottom-9 z-20 max-h-[28rem] w-96 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg">
          {prompts.length > 0 && (
            <>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Mijn en projectprompts</p>
              <ul className="mb-3 space-y-0.5">
                {prompts.map((p) => (
                  <li key={p.id} className="group flex items-center gap-2">
                    <button type="button" onClick={() => pick(p.body)} className="flex-1 truncate rounded px-2 py-1 text-left hover:bg-slate-100" title={p.body}>
                      {p.title}
                      <span className="ml-1 text-xs text-slate-400">{p.projectId ? "project" : "persoonlijk"}</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Verwijderen"
                      className="hidden text-xs text-slate-400 hover:text-rose-600 group-hover:block"
                      onClick={async () => {
                        await api(`/api/v1/prompts/${p.id}`, { method: "DELETE" }).catch((e: Error) => setError(e.message));
                        refresh();
                      }}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Voorbeelden</p>
          <ul className="mb-3 space-y-0.5">
            {STARTERS.map((p) => (
              <li key={p.title}>
                <button type="button" onClick={() => pick(p.body)} className="w-full truncate rounded px-2 py-1 text-left hover:bg-slate-100" title={p.body}>
                  {p.title}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-100 pt-2">
            <p className="mb-1 text-xs font-medium text-slate-600">Huidige tekst bewaren als prompt</p>
            <div className="flex gap-1.5">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Titel"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
              />
              <button
                type="button"
                disabled={!title.trim() || !currentText.trim()}
                onClick={save}
                className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-40"
              >
                Bewaar
              </button>
            </div>
            <label className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              Delen met projectleden
            </label>
            {!currentText.trim() && <p className="mt-1 text-xs text-slate-400">Typ eerst een tekst in het invoerveld.</p>}
            {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
