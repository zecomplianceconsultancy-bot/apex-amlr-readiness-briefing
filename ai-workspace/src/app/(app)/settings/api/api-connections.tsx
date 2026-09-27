"use client";

import { useState } from "react";
import { Button, Card, Input } from "@/components/ui";
import { api } from "@/lib/api-client";
import { formatUsd } from "@/lib/pricing";

type ProviderId = "anthropic" | "perplexity" | "openai";
interface Provider {
  id: ProviderId;
  label: string;
  keyPrefix: string;
  status: { connected: boolean; source: "app" | "env" | null; last4: string | null };
  budgetUsd: number;
  spentUsd: number;
}
interface Step {
  title: string;
  body: React.ReactNode;
  link?: [string, string];
}

const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-indigo-700 underline">
    {children}
  </a>
);

const GUIDES: Record<ProviderId, { intro: string; steps: Step[]; after: string }> = {
  anthropic: {
    intro: "Los van je Claude Max-abonnement: de API betaal je apart, per vraag. Een test met $20 is ruim genoeg voor honderden vragen met Claude Sonnet 5.",
    steps: [
      {
        title: "Open de Claude Console",
        body: <>Log in met je e-mailadres; dat mag hetzelfde zijn als voor claude.ai.</>,
        link: ["https://console.anthropic.com", "Open de Claude Console ↗"],
      },
      {
        title: "Koop $20 tegoed",
        body: (
          <>
            Ga naar <b>Billing</b>, voeg een betaalmethode toe en kies <b>Buy credits</b> → <b>$20</b>. Laat <b>auto-reload</b> uit: dan kan het nooit meer dan
            $20 worden.
          </>
        ),
      },
      {
        title: "Extra veiligheid: maandlimiet",
        body: (
          <>
            Onder <b>Limits</b> kun je ook een maandlimiet zetten, bijvoorbeeld $20. De workspace heeft daarnaast zijn eigen budget (hieronder).
          </>
        ),
      },
      {
        title: "Maak een sleutel",
        body: (
          <>
            Ga naar <b>API keys</b> → <b>Create key</b>, noem hem &quot;AI Workspace&quot; en klik <b>Copy</b>. De sleutel begint met <code>sk-ant-</code> en is maar
            één keer te zien.
          </>
        ),
      },
      { title: "Plak hem hieronder en klik Opslaan", body: <>De workspace test de verbinding meteen (gratis).</> },
    ],
    after: "Klaar. Kies in de chat bijvoorbeeld \"Claude Sonnet 5\" (snel en voordelig) of \"Claude Opus 5\" (sterkst), of laat Automatisch kiezen: Claude doet dan de controle- en reviewstappen.",
  },
  perplexity: {
    intro: "Los van je Perplexity Pro-abonnement: de API betaal je apart. Met Pro krijg je mogelijk al een klein maandelijks API-tegoed; dat zie je in het portaal.",
    steps: [
      {
        title: "Open het API-portaal",
        body: (
          <>
            Log in op <A href="https://www.perplexity.ai">perplexity.ai</A> met je gewone account en open <b>Instellingen → API</b> (het API-portaal).
          </>
        ),
        link: ["https://www.perplexity.ai/help-center/en/articles/10352995-api-settings", "Uitleg van Perplexity ↗"],
      },
      {
        title: "Koop $20 tegoed",
        body: (
          <>
            Onder <b>Billing</b>: betaalmethode toevoegen → <b>Buy credits</b> → <b>$20</b>. Zet <b>auto top-up</b> uit: dan kan het nooit meer dan $20 worden.
          </>
        ),
      },
      {
        title: "Maak een sleutel",
        body: (
          <>
            Onder <b>API Keys</b> → <b>+ Generate</b>, noem hem &quot;AI Workspace&quot; en kopieer hem. De sleutel begint met <code>pplx-</code>.
          </>
        ),
      },
      { title: "Plak hem hieronder en klik Opslaan", body: <>De workspace stelt één mini-vraag als test (kost minder dan $0,02).</> },
    ],
    after: "Klaar. Zoekvragen en de onderzoeksstap van Diep onderzoek gaan nu automatisch via \"Perplexity Sonar Pro (API)\", met bronnen.",
  },
  openai: {
    intro: "Optioneel. Alleen nodig als je ChatGPT ook automatisch wilt gebruiken; ChatGPT Plus en de API worden los betaald.",
    steps: [
      { title: "Open het OpenAI-platform", body: <>Log in en ga naar <b>Billing</b> om tegoed te kopen (bijv. $20).</>, link: ["https://platform.openai.com", "Open OpenAI Platform ↗"] },
      { title: "Maak een sleutel", body: <>Ga naar <b>API keys</b> → <b>Create new secret key</b>. De sleutel begint met <code>sk-</code>.</> },
      { title: "Plak hem hieronder en klik Opslaan", body: <>De workspace test de verbinding meteen (gratis).</> },
    ],
    after: "Klaar. Je kunt nu GPT-5.5 kiezen in de chat.",
  },
};

function SpendBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 100;
  const color = pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-600">
        <span>Deze maand besteed (schatting)</span>
        <span>
          {formatUsd(spent)} van {formatUsd(budget)}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      {pct >= 100 && <p className="mt-1 text-xs text-rose-700">Budget bereikt: deze API wordt deze maand niet meer gebruikt. Verhoog het budget om door te gaan.</p>}
    </div>
  );
}

function ProviderCard({ initial, optional }: { initial: Provider; optional?: boolean }) {
  const [p, setP] = useState(initial);
  const [key, setKey] = useState("");
  const [budget, setBudget] = useState(String(initial.budgetUsd));
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const guide = GUIDES[p.id];

  async function update(json: { key?: string | null; budgetUsd?: number }) {
    const res = await api<{ status: Provider["status"]; budgetUsd: number; spentUsd: number }>(`/api/v1/settings/api-keys/${p.id}`, { method: "PUT", json });
    setP((prev) => ({ ...prev, ...res }));
  }
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setResult(null);
    try {
      await fn();
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Mislukt." });
    } finally {
      setBusy(null);
    }
  }
  const test = () => run("test", async () => setResult(await api<{ ok: boolean; message: string }>(`/api/v1/settings/api-keys/${p.id}/test`, { method: "POST" })));
  const save = () =>
    run("save", async () => {
      await update({ key });
      setKey("");
      setResult(await api<{ ok: boolean; message: string }>(`/api/v1/settings/api-keys/${p.id}/test`, { method: "POST" }));
    });

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">
          {p.label}
          {optional && <span className="ml-2 text-xs font-normal text-slate-500">optioneel</span>}
        </h2>
        {p.status.connected ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            Gekoppeld ✓ · sleutel …{p.status.last4}
            {p.status.source === "env" && " (uit .env)"}
          </span>
        ) : (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">Nog niet gekoppeld</span>
        )}
      </div>
      <p className="text-sm text-slate-600">{guide.intro}</p>

      <details open={!p.status.connected && !optional} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Stappenplan ({guide.steps.length} stappen, ± 5 minuten)</summary>
        <ol className="mt-3 space-y-3">
          {guide.steps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">{i + 1}</span>
              <div className="text-sm text-slate-700">
                <p className="font-medium text-slate-900">{s.title}</p>
                <p className="mt-0.5">{s.body}</p>
                {s.link && (
                  <a href={s.link[0]} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-block rounded-md bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">
                    {s.link[1]}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      </details>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700">{p.status.connected ? "Nieuwe sleutel (vervangt de huidige)" : "API-sleutel"}</label>
        <div className="flex gap-2">
          <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={`${p.keyPrefix}…`} className="flex-1 font-mono" />
          <Button disabled={!key.trim() || busy !== null} onClick={() => void save()}>
            {busy === "save" ? "Opslaan & testen…" : "Opslaan"}
          </Button>
        </div>
        {key.trim() && !key.trim().startsWith(p.keyPrefix) && (
          <p className="text-xs text-amber-800">Een sleutel van {p.label} begint met &quot;{p.keyPrefix}&quot;. Heb je de juiste gekopieerd?</p>
        )}
        <p className="text-xs text-slate-500">De sleutel wordt versleuteld opgeslagen op deze computer en daarna nooit meer getoond (alleen de laatste 4 tekens).</p>
      </div>

      {result && (
        <p className={`rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>
          {result.ok ? "✓ " : "✗ "}
          {result.message}
        </p>
      )}
      {result?.ok && <p className="text-sm text-slate-700">{guide.after}</p>}

      <div className="grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-700">Maandbudget in de workspace (USD)</label>
          <div className="flex gap-2">
            <Input type="number" min={0} step={5} value={budget} onChange={(e) => setBudget(e.target.value)} className="w-28" />
            <Button variant="secondary" disabled={busy !== null || Number(budget) === p.budgetUsd} onClick={() => void run("budget", () => update({ budgetUsd: Number(budget) }))}>
              Opslaan
            </Button>
          </div>
          <p className="text-xs text-slate-500">Bij dit bedrag stopt de workspace met deze API tot de volgende maand.</p>
        </div>
        <SpendBar spent={p.spentUsd} budget={p.budgetUsd} />
      </div>

      {p.status.connected && (
        <div className="flex gap-3 text-sm">
          <Button variant="secondary" disabled={busy !== null} onClick={() => void test()}>
            {busy === "test" ? "Testen…" : "Test verbinding"}
          </Button>
          {p.status.source === "app" && (
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => {
                if (confirm(`Sleutel van ${p.label} verwijderen uit de workspace?`)) void run("remove", () => update({ key: null }));
              }}
            >
              Sleutel verwijderen
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

export function ApiConnections({ providers }: { providers: Provider[] }) {
  return (
    <div className="space-y-5">
      <Card className="border-indigo-200 bg-indigo-50/40 text-sm text-slate-700">
        <p className="font-medium text-slate-900">Zo werkt het</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>Je koopt bij de aanbieder een vast tegoed (bijv. $20) en maakt een sleutel. Die plak je hier.</li>
          <li>De workspace gebruikt de API daarna automatisch waar die het sterkst is, en stopt bij het maandbudget.</li>
          <li>Wat een vraag ongeveer kost, zie je onder <a href="/costs" className="font-medium text-indigo-700 underline">Kosten</a>. Richtlijn: Claude Sonnet 5 ± $0,01–0,02 per vraag.</li>
        </ul>
      </Card>
      {providers.map((p) => (
        <ProviderCard key={p.id} initial={p} optional={p.id === "openai"} />
      ))}
    </div>
  );
}
