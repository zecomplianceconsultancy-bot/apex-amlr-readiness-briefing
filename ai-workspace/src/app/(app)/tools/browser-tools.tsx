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

export function BrowserTools({ enabled, sites: initial }: { enabled: boolean; sites: Site[] }) {
  const [sites, setSites] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "open" | "check") {
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
    return <ErrorText>Browser-tools staan uit. Zet ENABLE_BROWSER_PROVIDER=true in .env en herstart de app.</ErrorText>;
  }

  return (
    <div className="space-y-4">
      <Card className="text-sm text-slate-600">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Klik <b>Openen</b>: er opent een browservenster (apart profiel) met de tool.
          </li>
          <li>Log daar zelf in (incl. 2FA/captcha). Zet in de tool het gebruik van je data voor training uit.</li>
          <li>
            Klik <b>Controleer</b>. Bij &quot;Klaar&quot; is de tool in elk project als model te kiezen.
          </li>
          <li>
            Verschijnt er &quot;Verifieer dat u een mens bent&quot;? Rond die controle zelf af in het browservenster; de workspace wacht daarop
            (maximaal een minuut) en gaat daarna verder.
          </li>
        </ol>
        <p className="mt-2 text-xs text-slate-500">
          Laat het browservenster open terwijl je werkt; de workspace typt prompts en leest antwoorden en bronnen terug. Browser-tools mogen alleen data
          tot classificatie &quot;Intern&quot; ontvangen.
        </p>
      </Card>
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
                  <Button variant="secondary" disabled={busy !== null} onClick={() => void act(s.id, "open")}>
                    {busy === `${s.id}:open` ? "Openen…" : "Openen"}
                  </Button>
                  <Button disabled={busy !== null} onClick={() => void act(s.id, "check")}>
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
