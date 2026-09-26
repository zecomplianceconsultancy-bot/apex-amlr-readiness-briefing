import { notFound } from "next/navigation";
import { isUuid, requirePageProject } from "@/server/auth/page-guards";
import { listConversations } from "@/server/conversations/service";
import { ProjectSidebar } from "@/components/project-sidebar";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) notFound();
  const { project, role } = await requirePageProject(projectId);
  const conversations = await listConversations(project.id);
  return (
    <div className="flex h-full">
      <ProjectSidebar
        project={{ id: project.id, name: project.name, classification: project.classification, piiRedaction: project.piiRedaction }}
        role={role}
        conversations={conversations.map((c) => ({ id: c.id, title: c.title }))}
      />
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
