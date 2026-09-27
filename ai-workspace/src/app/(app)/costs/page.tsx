import { requirePageUser } from "@/server/auth/page-guards";
import { monthlyUsage } from "@/server/usage/service";
import { Card, PageHeader } from "@/components/ui";
import { apiCost, formatUsd, PRICES_CHECKED, TOOL_PRICING } from "@/lib/pricing";

export default async function CostsPage() {
  const user = await requirePageUser();
  const { since, usage } = await monthlyUsage(user.id);
  const month = new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric" }).format(since);
  const rows = TOOL_PRICING.map((p) => {
    const u = usage.find((x) => x.tool === p.tool)!;
    const cost = apiCost(p.reference, u.inputTokens, u.outputTokens);
    const perQuestion = u.questions ? cost / u.questions : null;
    return { p, u, cost, perQuestion };
  });
  const totalApi = rows.reduce((s, r) => s + r.cost, 0);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <PageHeader
        title="Kosten & gebruik"
        description={`Wat je per tool gebruikt en wat dat via een API zou kosten, naast de abonnementsprijzen. Prijzen: openbare lijstprijzen in USD excl. btw, gecontroleerd ${PRICES_CHECKED} — controleer altijd bij de aanbieder.`}
      />

      <Card className="p-0">
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="font-medium">Jouw gebruik in {month}</h2>
          <p className="text-xs text-slate-500">
            Geschat op basis van je vragen en antwoorden (± 4 tekens per token). Laat zien of een API goedkoper zou zijn dan een abonnement.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2">Tool</th>
              <th className="px-5 py-2">Vragen</th>
              <th className="px-5 py-2">Via API geschat</th>
              <th className="px-5 py-2">Per vraag</th>
              <th className="px-5 py-2">Abonnement (Pro/Plus)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ p, u, cost, perQuestion }) => (
              <tr key={p.tool}>
                <td className="px-5 py-2">
                  <div className="font-medium">{p.label}</div>
                  <div className="text-xs text-slate-500">{p.bestFor}</div>
                </td>
                <td className="px-5 py-2">{u.questions}</td>
                <td className="px-5 py-2">
                  {formatUsd(cost)}
                  <div className="text-xs text-slate-400">{p.reference.model}</div>
                </td>
                <td className="px-5 py-2">{perQuestion === null ? "—" : formatUsd(perQuestion)}</td>
                <td className="px-5 py-2">{p.plans.find((x) => /Pro|Plus/.test(x.name) && !/AI Plus/.test(x.name))?.price ?? p.plans[1]?.price}</td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-medium">
              <td className="px-5 py-2">Totaal</td>
              <td className="px-5 py-2">{rows.reduce((s, r) => s + r.u.questions, 0)}</td>
              <td className="px-5 py-2">{formatUsd(totalApi)}</td>
              <td className="px-5 py-2" />
              <td className="px-5 py-2 text-xs font-normal text-slate-500">≈ $20 per tool per maand</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {TOOL_PRICING.map((p) => (
          <Card key={p.tool}>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-medium">{p.label}</h3>
              <a href={p.pricingUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:underline">
                actuele prijzen ↗
              </a>
            </div>
            <p className="mb-3 text-xs text-slate-500">Sterk in: {p.bestFor}</p>
            <table className="mb-3 w-full text-xs">
              <thead className="text-left text-slate-400">
                <tr>
                  <th className="pb-1">Abonnement</th>
                  <th className="pb-1">Prijs</th>
                </tr>
              </thead>
              <tbody>
                {p.plans.map((pl) => (
                  <tr key={pl.name}>
                    <td className="py-0.5 text-slate-700">{pl.name}</td>
                    <td className="py-0.5">
                      {pl.price}
                      {pl.note && <span className="text-slate-400"> · {pl.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="w-full text-xs">
              <thead className="text-left text-slate-400">
                <tr>
                  <th className="pb-1">API-model</th>
                  <th className="pb-1">per 1M tokens in / uit</th>
                </tr>
              </thead>
              <tbody>
                {p.api.map((a) => (
                  <tr key={a.model}>
                    <td className="py-0.5 text-slate-700">{a.model}</td>
                    <td className="py-0.5">
                      ${a.input} / ${a.output}
                      {a.note && <span className="text-slate-400"> · {a.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>

      <Card className="text-sm text-slate-600">
        <h2 className="mb-1 font-medium text-slate-800">Vuistregels</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Handmatig werken kost alleen je abonnementen. Met de gratis versies kun je al veel; betaal pas voor de tool die je het meest gebruikt.</li>
          <li>API-kosten zijn per vraag meestal enkele centen. Bij een paar honderd vragen per maand blijft dat vaak onder de prijs van één abonnement.</li>
          <li>Voor klantdossiers: gebruik zakelijke abonnementen (Team/Business) of de API, vanwege verwerkersovereenkomsten en geen training op je data.</li>
        </ul>
      </Card>
    </main>
  );
}
