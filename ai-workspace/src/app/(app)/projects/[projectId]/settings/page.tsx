import { listModelsFor, toClientModel } from "@/server/ai/catalog";
import { MODEL_REGISTRY } from "@/server/ai/registry";
import { requirePageProject } from "@/server/auth/page-guards";
import { listMembers } from "@/server/projects/service";
import { PageHeader } from "@/components/ui";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project, role } = await requirePageProject(projectId);
  const members = await listMembers(project.id);
  return (
    <main className="mx-auto max-w-4xl p-6">
      <PageHeader title="Instellingen" description="Classificatie, datapolicy, standaardmodel en toegang. Wijzigingen worden in de audit trail vastgelegd." />
      <SettingsForm
        projectId={project.id}
        isOwner={role === "owner"}
        project={{
          name: project.name,
          description: project.description,
          classification: project.classification,
          piiRedaction: project.piiRedaction,
          defaultModelId: project.defaultModelId,
        }}
        models={listModelsFor(project.classification).map(toClientModel)}
        registry={MODEL_REGISTRY.map((m) => ({ id: m.id, label: m.label, clearance: m.clearance }))}
        members={members}
      />
    </main>
  );
}
