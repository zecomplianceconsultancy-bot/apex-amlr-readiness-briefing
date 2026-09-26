import Link from "next/link";
import { requirePageUser } from "@/server/auth/page-guards";
import { searchConversations } from "@/server/conversations/service";
import { PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

function snippet(text: string, q: string): { before: string; hit: string; after: string } {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return { before: text.slice(0, 200), hit: "", after: text.length > 200 ? "…" : "" };
  const start = Math.max(0, i - 80);
  return {
    before: (start > 0 ? "…" : "") + text.slice(start, i),
    hit: text.slice(i, i + q.length),
    after: text.slice(i + q.length, i + q.length + 120) + (text.length > i + q.length + 120 ? "…" : ""),
  };
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePageUser();
  const q = ((await searchParams).q ?? "").trim();
  const results = q.length >= 2 ? await searchConversations(user.id, q) : [];
  return (
    <main className="mx-auto max-w-4xl p-6">
      <PageHeader title="Zoeken" description="Doorzoekt de gesprekken in al je projecten." />
      <form action="/search" className="mb-6 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          autoFocus
          placeholder="Zoekterm (minimaal 2 tekens)"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <button className="rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white">Zoek</button>
      </form>
      {q.length >= 2 && <p className="mb-3 text-sm text-slate-500">{results.length === 50 ? "50+ resultaten (verfijn je zoekterm)" : `${results.length} resultaten`}</p>}
      <ul className="space-y-2">
        {results.map((r) => {
          const s = snippet(r.content, q);
          return (
            <li key={r.messageId}>
              <Link href={`/projects/${r.projectId}/c/${r.conversationId}`} className="block rounded-xl border border-slate-200 bg-white p-3 hover:border-indigo-300">
                <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                  <span>
                    <span className="font-medium text-slate-700">{r.title}</span> · {r.projectName} · {r.role === "user" ? "vraag" : "antwoord"}
                  </span>
                  <span>{formatDateTime(r.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-700">
                  {s.before}
                  {s.hit && <mark className="rounded bg-yellow-100 px-0.5">{s.hit}</mark>}
                  {s.after}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
