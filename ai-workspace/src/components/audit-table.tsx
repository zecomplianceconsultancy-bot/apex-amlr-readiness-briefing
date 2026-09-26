import { formatDateTime } from "@/lib/format";

export interface AuditRow {
  seq: number;
  occurredAt: Date;
  action: string;
  actorName: string | null;
  actorType: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  details: unknown;
  hash: string;
}

export function AuditTable({ events }: { events: AuditRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-xs">
        <thead className="border-b border-slate-200 text-left uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Tijdstip</th>
            <th className="px-3 py-2">Actie</th>
            <th className="px-3 py-2">Actor</th>
            <th className="px-3 py-2">Object</th>
            <th className="px-3 py-2">Details</th>
            <th className="px-3 py-2">Hash</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 align-top">
          {events.map((e) => (
            <tr key={e.seq}>
              <td className="px-3 py-2 text-slate-400">{e.seq}</td>
              <td className="whitespace-nowrap px-3 py-2">{formatDateTime(e.occurredAt)}</td>
              <td className="whitespace-nowrap px-3 py-2 font-medium">{e.action}</td>
              <td className="px-3 py-2">{e.actorName ?? e.actorType}</td>
              <td className="px-3 py-2 text-slate-500">
                {e.entityType}
                {e.entityId && <div className="font-mono text-[10px]">{e.entityId.slice(0, 8)}…</div>}
              </td>
              <td className="max-w-md px-3 py-2">
                <code className="break-all text-[11px] text-slate-600">{JSON.stringify(e.details)}</code>
              </td>
              <td className="px-3 py-2 font-mono text-[10px] text-slate-400" title={e.hash}>
                {e.hash.slice(0, 10)}…
              </td>
            </tr>
          ))}
          {events.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                Geen events.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
