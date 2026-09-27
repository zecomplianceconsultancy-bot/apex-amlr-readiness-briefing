import Link from "next/link";
import { requirePageProject } from "@/server/auth/page-guards";
import { projectSources } from "@/server/sources/service";
import { Card, PageHeader } from "@/components/ui";
import { CopyButton } from "@/components/chat/copy-button";

const date = (d: Date) => d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });

export default async function SourcesPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ q?: string; domein?: string }> }) {
  const { projectId } = await params;
  const { q = "", domein = "" } = await searchParams;
  const { project } = await requirePageProject(projectId);
  const all = await projectSources(project.id);

  const domains = [...all.reduce((m, s) => m.set(s.domain, (m.get(s.domain) ?? 0) + s.count), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const needle = q.trim().toLowerCase();
  const shown = all.filter(
    (s) => (!domein || s.domain === domein) && (!needle || s.url.toLowerCase().includes(needle) || (s.title ?? "").toLowerCase().includes(needle)),
  );
  const base = `/projects/${project.id}/sources`;
  const bibliography = shown.map((s) => `- [${s.title ?? s.domain}](${s.url}) — geraadpleegd ${date(s.lastSeen)}`).join("\n");

  return (
    <main className="mx-auto max-w-5xl p-6">
      <PageHeader
        title="Bronnenbibliotheek"
        description="Alle bronnen die de tools in dit project hebben aangehaald, ontdubbeld. Hoe vaker een bron terugkomt, hoe hoger hij staat. Handig voor dossiervorming en om te zien waar je antwoorden op gebaseerd zijn."
        actions={
          shown.length > 0 ? (
            <span className="shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ring-1 ring-slate-300">
              <CopyButton text={bibliography} label="Kopieer als bronnenlijst" />
            </span>
          ) : undefined
        }
      />

      {all.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            Nog geen bronnen. Bronnen verschijnen hier zodra een tool ze noemt — bijvoorbeeld een antwoord van Perplexity, of Diep onderzoek.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              [all.length, "unieke bronnen"],
              [domains.length, "websites"],
              [all.reduce((n, s) => n + s.count, 0), "keer aangehaald"],
            ].map(([n, l]) => (
              <Card key={l} className="p-4">
                <p className="text-2xl font-semibold">{n}</p>
                <p className="text-xs text-slate-500">{l}</p>
              </Card>
            ))}
          </div>

          <form action={base} className="flex flex-wrap items-center gap-2">
            <input
              name="q"
              defaultValue={q}
              placeholder="Zoek in bronnen…"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
            />
            {domein && <input type="hidden" name="domein" value={domein} />}
            <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">Zoek</button>
          </form>

          <div className="flex flex-wrap gap-1.5">
            <Link href={q ? `${base}?q=${encodeURIComponent(q)}` : base} className={`rounded-full px-2.5 py-0.5 text-xs ${!domein ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
              Alle websites
            </Link>
            {domains.slice(0, 15).map(([d, n]) => (
              <Link
                key={d}
                href={`${base}?domein=${encodeURIComponent(d)}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={`rounded-full px-2.5 py-0.5 text-xs ${domein === d ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
              >
                {d} · {n}
              </Link>
            ))}
          </div>

          <Card className="divide-y divide-slate-100 p-0">
            {shown.length === 0 && <p className="p-4 text-sm text-slate-500">Geen bronnen gevonden met dit filter.</p>}
            {shown.map((s) => (
              <div key={s.url} className="flex gap-3 px-4 py-3">
                <span className="mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-1.5 text-xs font-semibold text-slate-600" title="Aantal keer aangehaald">
                  {s.count}×
                </span>
                <div className="min-w-0 flex-1">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-medium text-indigo-700 hover:underline" title={s.url}>
                    {s.title ?? s.url}
                  </a>
                  <p className="truncate text-xs text-slate-500">
                    {s.domain} · {s.count > 1 ? `${date(s.firstSeen)} – ${date(s.lastSeen)}` : date(s.lastSeen)} · via {s.tools.join(", ")}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.conversations.slice(0, 5).map((c) => (
                      <Link key={c.id} href={`/projects/${project.id}/c/${c.id}`} className="truncate rounded bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100">
                        {c.title}
                      </Link>
                    ))}
                    {s.conversations.length > 5 && <span className="text-[11px] text-slate-400">+{s.conversations.length - 5}</span>}
                  </div>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </main>
  );
}
