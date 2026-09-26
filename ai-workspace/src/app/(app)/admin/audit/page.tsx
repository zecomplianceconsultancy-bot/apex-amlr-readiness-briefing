import { notFound } from "next/navigation";
import { verifyAuditChain } from "@/server/audit/audit";
import { listAuditEvents } from "@/server/audit/queries";
import { requirePageUser } from "@/server/auth/page-guards";
import { AuditTable } from "@/components/audit-table";
import { PageHeader } from "@/components/ui";

export default async function AdminAuditPage() {
  const user = await requirePageUser();
  if (user.role !== "admin") notFound();
  const [events, verification] = await Promise.all([listAuditEvents({ limit: 200 }), verifyAuditChain()]);
  return (
    <main className="p-6">
      <PageHeader
        title="Audit trail (platform)"
        description="Alle events, alle projecten. Metadata only — projectinhoud is alleen zichtbaar voor projectleden."
        actions={
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${verification.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
            {verification.ok ? `Hash-chain intact (${verification.checked} events)` : `Hash-chain BROKEN bij #${verification.brokenAtSeq}: ${verification.reason}`}
          </span>
        }
      />
      <AuditTable events={events} />
    </main>
  );
}
