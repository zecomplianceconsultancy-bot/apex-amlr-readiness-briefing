import type { Citation } from "./types";

export function Sources({ citations, open = false }: { citations: Citation[]; open?: boolean }) {
  if (!citations.length) return null;
  return (
    <details open={open} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs">
      <summary className="cursor-pointer font-medium text-slate-600">Bronnen ({citations.length})</summary>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        {citations.map((c) => (
          <li key={c.url}>
            <a href={c.url} target="_blank" rel="noopener noreferrer" className="break-all text-indigo-600 hover:underline">
              {c.title || c.url}
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function uniqueCitations(lists: Citation[][]): Citation[] {
  const seen = new Set<string>();
  return lists.flat().filter((c) => c.url && !seen.has(c.url) && seen.add(c.url));
}
