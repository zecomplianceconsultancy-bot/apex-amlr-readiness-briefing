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
type BrowserId = "msedge" | "chrome" | "chromium";
interface BrowserOption {
  id: BrowserId;
  label: string;
  installed: boolean;
}
interface Props {
  enabled: boolean;
  mode: "off" | "ask";
  browser: BrowserId;
  browsers: BrowserOption[];
  profileDir: string;
  allowedDomains: string[];
  loginProviders: string;
  sites: Site[];
}

const STATE_STYLE: Record<string, [string, string]> = {
  ready: ["Klaar", "bg-emerald-50 text-emerald-700"],
  login_required: ["Inloggen nodig", "bg-amber-50 text-amber-800"],
  human_check: ["Menselijke controle nodig", "bg-amber-50 text-amber-800"],
  error: ["Fout", "bg-rose-50 text-rose-700"],
};

export function BrowserTools({ enabled, mode: initialMode, browser: initialBrowser, browsers, profileDir, allowedDomains, loginProviders, sites: initial }: Props) {
  const [sites, setSites] = useState(initial);
  const [mode, setMode] = useState(initialMode);
  const [browser, setBrowser] = useState(initialBrowser);
  const browserLabel = browsers.find((b) => b.id === browser)?.label ?? browser;

  async function changeBrowser(next: BrowserId) {
    const label = browsers.find((b) => b.id === next)?.label ?? next;
    if (!confirm(`Alleen ${label} gebruiken voor browserbesturing?\n\nDe workspace start dan uitsluitend ${label}, in een eigen werkprofiel, en nooit een andere browser. Een open bestuurd venster wordt gesloten.`)) return;
    setError(null);
    try {
      const res = await api<{ browser: BrowserId }>("/api/v1/settings/browser-control", { method: "PUT", json: { browser: next } });
      setBrowser(res.browser);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wijzigen mislukt.");
    }
  }

  async function changeMode(next: "off" | "ask") {
    if (next === "ask" && !confirm(`Browserbesturing toestaan?\n\nDe workspace mag dan een apart ${browserLabel}-venster (eigen werkprofiel) openen en daarin vragen typen en antwoorden uitlezen — maar alleen nadat je elke keer toestemming geeft.`)) return;
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
    if (!confirm(`Mag de workspace ${label} openen in het aparte, door de workspace bestuurde ${browserLabel}-venster?`)) return;
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
      <Card>
        <h2 className="mb-1 font-medium">Welke browser mag de workspace besturen?</h2>
        <p className="mb-3 text-sm text-slate-600">
          De workspace start alleen de browser die je hier kiest, en valt nooit terug op een andere. Staat die browser niet op deze computer, dan gebeurt er niets.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {browsers.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => b.id !== browser && void changeBrowser(b.id)}
              className={`rounded-lg border p-3 text-left ${b.id === browser ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500" : "border-slate-200 hover:bg-slate-50"}`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className={`h-3.5 w-3.5 rounded-full border ${b.id === browser ? "border-4 border-indigo-600" : "border-slate-400"}`} />
                {b.label}
              </span>
              <span className={`mt-1 block text-xs ${b.installed ? "text-emerald-700" : "text-slate-500"}`}>
                {b.installed ? "Gevonden op deze computer" : "Niet gevonden op deze computer"}
                {b.id === "msedge" && " · aanbevolen"}
              </span>
            </button>
          ))}
        </div>
        {!browsers.find((b) => b.id === browser)?.installed && (
          <p className="mt-2 text-xs text-amber-800">{browserLabel} is niet gevonden. Installeer hem, of kies een andere browser.</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-medium">Wat de workspace wel en niet kan zien</h2>
        <ul className="space-y-1.5 text-sm text-slate-700">
          <li>
            ✅ Alleen het aparte {browserLabel}-venster dat de workspace zelf opent, met een eigen werkprofiel in <code className="text-xs">{profileDir}</code>.
          </li>
          <li>🚫 Niet je gewone browservensters en tabbladen, geschiedenis, wachtwoorden, favorieten, cookies of extensies.</li>
          <li>🚫 Geen andere browsers{browser === "msedge" ? " (dus geen Chrome)" : ""}. Geen synchronisatie met je browseraccount.</li>
          <li>
            🔒 In het venster alleen deze websites: <b>{allowedDomains.join(", ")}</b> en de {loginProviders}. Andere websites worden geblokkeerd en in de audit trail
            vastgelegd.
          </li>
          <li>🚫 Geen downloads, camera, microfoon, locatie of meldingen. Geen schermbesturing buiten dit venster.</li>
          <li>✋ Niets zonder toestemming: elke actie vraagt eerst om jouw akkoord.</li>
        </ul>
      </Card>

      {mode === "ask" && (
        <Card className="text-sm text-slate-600">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Klik <b>Openen</b> en bevestig: er opent een apart {browserLabel}-venster met de tool.
            </li>
            <li>
              Log daar zelf in op de AI-tool, <b>niet</b> op je {browser === "msedge" ? "Microsoft-/Edge" : browser === "chrome" ? "Google-/Chrome" : "browser"}
              profiel: dan blijven je persoonlijke gegevens buiten dit venster. Zet in de tool het gebruik van je data voor training uit.
            </li>
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
