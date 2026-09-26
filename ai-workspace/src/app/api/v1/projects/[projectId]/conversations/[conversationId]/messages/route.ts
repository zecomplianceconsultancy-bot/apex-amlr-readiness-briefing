import { runChatTurn } from "@/server/ai/orchestrator";
import { authed, parseId, parseJson } from "@/server/http/api";
import { sendMessageSchema } from "@/server/http/schemas";
import { sseResponse } from "@/server/http/sse";

type Params = { projectId: string; conversationId: string };

/**
 * Sends a user message and streams the model's answer as Server-Sent Events:
 *   event: meta  → ids, chosen model, routing reason, redaction count, context warnings
 *   event: delta → text chunk
 *   event: done  → final text, sources, finish reason, reported model version, usage, latency
 *   event: error → { code, message }
 */
export const POST = authed<Params>(async (req, { user, params, meta }) => {
  const body = await parseJson(req, sendMessageSchema);
  return sseResponse(
    runChatTurn({
      user,
      meta,
      projectId: parseId(params.projectId, "Project"),
      conversationId: parseId(params.conversationId, "Gesprek"),
      content: body.content,
      modelId: body.modelId,
      signal: req.signal,
    }),
  );
});
