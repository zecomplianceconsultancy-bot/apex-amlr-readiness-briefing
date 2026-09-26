import { requirePageProject } from "@/server/auth/page-guards";
import { listContextVersions } from "@/server/projects/service";
import { PageHeader } from "@/components/ui";
import { ContextEditor } from "./context-editor";

export default async function ContextPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project, role } = await requirePageProject(projectId);
  const versions = await listContextVersions(project.id);
  return (
    <main className="mx-auto max-w-4xl p-6">
      <PageHeader
        title="Projectcontext"
        description="Vaste instructies en achtergrond die in elk gesprek van dit project worden meegestuurd. Elke wijziging wordt een nieuwe versie; elk AI-antwoord legt vast welke versie is gebruikt."
      />
      <ContextEditor
        projectId={project.id}
        canEdit={role !== "viewer"}
        versions={versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() }))}
      />
    </main>
  );
}
