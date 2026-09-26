import { notFound } from "next/navigation";
import { listModelsFor, toClientModel } from "@/server/ai/catalog";
import { listRunsForConversation } from "@/server/ai/workflows/runs";
import { isUuid, requirePageProject } from "@/server/auth/page-guards";
import { getConversation, listMessages } from "@/server/conversations/service";
import { HttpError } from "@/server/http/errors";
import { ChatView } from "@/components/chat/chat-view";

export default async function ConversationPage({ params }: { params: Promise<{ projectId: string; conversationId: string }> }) {
  const { projectId, conversationId } = await params;
  if (!isUuid(conversationId)) notFound();
  const { project, role } = await requirePageProject(projectId);
  const conversation = await getConversation(project.id, conversationId).catch((err) => {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  });
  const [messages, runs] = await Promise.all([listMessages(conversation.id), listRunsForConversation(conversation.id)]);
  return (
    <ChatView
      key={conversation.id}
      projectId={project.id}
      conversationId={conversation.id}
      title={conversation.title}
      canWrite={role !== "viewer"}
      projectDefaultModelId={project.defaultModelId}
      models={listModelsFor(project.classification).map(toClientModel)}
      initialMessages={messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        status: m.status,
        run: m.runId ? runs[m.runId] : undefined,
        stats: m.invocationId
          ? {
              invocationId: m.invocationId,
              modelId: m.modelId,
              modelReported: m.modelReported,
              inputTokens: m.inputTokens,
              outputTokens: m.outputTokens,
              latencyMs: m.latencyMs,
              finishReason: m.finishReason,
              citations: (m.citations as { url?: string; title?: string }[] | null) ?? [],
            }
          : undefined,
      }))}
    />
  );
}
