import { redirect } from "next/navigation";
import { requirePageProject } from "@/server/auth/page-guards";
import { listConversations } from "@/server/conversations/service";
import { NewConversationButton } from "@/components/new-conversation-button";

export default async function ProjectHome({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project, role } = await requirePageProject(projectId);
  const [latest] = await listConversations(project.id);
  if (latest) redirect(`/projects/${project.id}/c/${latest.id}`);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-lg font-semibold">{project.name}</h1>
      <p className="max-w-md text-sm text-slate-500">
        Nog geen gesprekken. Projectcontext en bestanden die je toevoegt worden automatisch in elk gesprek meegenomen.
      </p>
      {role !== "viewer" && <NewConversationButton projectId={project.id} />}
    </div>
  );
}
