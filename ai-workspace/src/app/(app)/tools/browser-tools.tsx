"use client";

import { useState } from "react";
import { Button, Card, ErrorText } from "@/components/ui";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

interface Status {
  state: "ready" | "login_required" | "human_check" | "error";
  checkedAt: string;
  url?: string;
  detail?: string;
}
interface Site {
  id: string;
  label: string;
  url: string;
  status: Status | null;
}

const STATE_STYLE: Record<string, [string, string]> = {
  ready: ["Klaar", "bg-emerald-50 text-emerald-700"],
  login_required: ["Inloggen nodig", "bg-amber-50 text-amber-800"],
  human_check: ["Menselijke controle nodig", "bg-amber-50 text-amber-800"],
  error: ["Fout", "bg-rose-50 text-rose-700"],
};

export function BrowserTools({ enabled, mode: initialMode, sites: initial }: { enabled: boolean; mode: "off" | "ask"; sites: Site[] }) {
  const [sites, setSites] = useState(initial);
  const [mode, setMode] = useState(initialMode);

  async function changeMode(next: "off" | "ask") {
    if (next === "ask" && !confirm("Browserbesturing toestaan?\n\nDe workspace mag dan een apart Chrome-venster openen en daarin vragen typen en antwoorden uitlezen — maar alleen nadat je elke keer toestemming geeft.")) return;
    setError(null);
    try {
      await api("/api/v1/settings/browser-control", { method: "PUT", json: { mode: next } });
      setMode(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wijzigen mislukt.");
    }
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "open" | "check") {
    const label = sites.find((s) => s.id === id)?.label ?? id;
    if (!confirm(`Mag de workspace ${label} openen in een apart, door de workspace bestuurd Chrome-venster?`)) return;
    setBusy(`${id}:${action}`);
    setError(null);
    try {
      const res = await api<{ status?: Status }>(`/api/v1/browser/sites/${id}/${action}`, { method: "POST" });
      if (res.status) setSites((prev) => prev.map((s) => (s.id === id ? { ...s, status: res.status! } : s)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Actie mislukt.");
    } finally {
      setBusy(null);
    }
  }

  if (!enabled) {
    return <ErrorText>Browser-tools zijn uitgeschakeld in de configuratie (ENABLE_BROWSER_PROVIDER=false).</ErrorText>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 font-medium">Toestemming voor browserbesturing</h2>
        <p className="mb-3 text-sm text-slate-600">
          Standaard <b>uit</b>: de workspace opent en bestuurt dan nooit een browservenster. Met <b>Vragen per keer</b> vraagt de workspace vóór elke actie om je
          toestemming (eenmalig, of tot je de workspace afsluit). Een &quot;altijd toestaan&quot; bestaat bewust niet. Elke keuze komt in de audit trail.
        </p>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
          {(
            [
              ["off", "Uit (aanbevolen)"],
              ["ask", "Vragen per keer"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => mode !== value && void changeMode(value)}
              className={`rounded-md px-3 py-1 text-sm font-medium ${mode === value ? "bg-white text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "off" && (
          <p className="mt-3 text-xs text-slate-500">
            Werk intussen met de modellen &quot;(handmatig)&quot; in de chat: de workspace zet de vraag klaar, jij verstuurt hem in je eigen browser en plakt het
            antwoord terug. Of vul een API-sleutel in (bijv. PERPLEXITY_API_KEY) voor volledig automatische, officiële koppelingen.
          </p>
        )}
      </Card>
      {mode === "ask" && (
        <Card className="text-sm text-slate-600">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Klik <b>Openen</b> en bevestig: er opent een apart Chrome-venster met de tool.
            </li>
            <li>Log daar zelf in. Zet in de tool het gebruik van je data voor training uit.</li>
            <li>
              Klik <b>Controleer</b>. Bij &quot;Klaar&quot; is de tool als model te kiezen; bij elk gebruik vraagt de workspace eerst toestemming.
            </li>
            <li>
              Blijft &quot;Verifieer dat u een mens bent&quot; terugkomen? Dan blokkeert de site bestuurde browsers: gebruik de handmatige route of een API.
            </li>
          </ol>
        </Card>
      )}
      <ErrorText>{error}</ErrorText>
      <Card className="p-0">
        <ul className="divide-y divide-slate-100">
          {sites.map((s) => {
            const [label, style] = s.status ? STATE_STYLE[s.status.state]! : ["Niet gecontroleerd", "bg-slate-100 text-slate-600"];
            return (
              <li key={s.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{s.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{label}</span>
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {s.url}
                    {s.status && ` · ${formatDateTime(s.status.checkedAt)}`}
                  </div>
                  {s.status?.detail && <div className="text-xs text-slate-500">{s.status.detail}</div>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" disabled={busy !== null || mode === "off"} onClick={() => void act(s.id, "open")}>
                    {busy === `${s.id}:open` ? "Openen…" : "Openen"}
                  </Button>
                  <Button disabled={busy !== null || mode === "off"} onClick={() => void act(s.id, "check")}>
                    {busy === `${s.id}:check` ? "Controleren…" : "Controleer"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
