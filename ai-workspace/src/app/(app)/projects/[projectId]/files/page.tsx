import { requirePageProject } from "@/server/auth/page-guards";
import { listFiles } from "@/server/files/service";
import { env } from "@/server/config/env";
import { PageHeader } from "@/components/ui";
import { FileManager } from "./file-manager";

export default async function FilesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project, role } = await requirePageProject(projectId);
  const files = await listFiles(project.id);
  return (
    <main className="mx-auto max-w-4xl p-6">
      <PageHeader
        title="Bestanden"
        description="Bestanden worden versleuteld opgeslagen. Tekst van bestanden met 'In context' wordt meegestuurd in gesprekken (na PII-masking indien actief)."
      />
      <FileManager
        projectId={project.id}
        canEdit={role !== "viewer"}
        maxMb={env().MAX_UPLOAD_MB}
        files={files.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() }))}
      />
    </main>
  );
}
