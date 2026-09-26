import { listAuditEvents } from "@/server/audit/queries";
import { requirePageProject } from "@/server/auth/page-guards";
import { AuditTable } from "@/components/audit-table";
import { PageHeader } from "@/components/ui";

export default async function ProjectAuditPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project } = await requirePageProject(projectId, "owner");
  const events = await listAuditEvents({ projectId: project.id, limit: 200 });
  return (
    <main className="p-6">
      <PageHeader title="Audit trail" description="Append-only en hash-chained. Laatste 200 events van dit project." />
      <AuditTable events={events} />
    </main>
  );
}
