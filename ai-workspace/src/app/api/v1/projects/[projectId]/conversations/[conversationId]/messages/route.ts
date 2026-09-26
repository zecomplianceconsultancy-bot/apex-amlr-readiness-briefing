import { runChatTurn, type ChatTurnEvent } from "@/server/ai/orchestrator";
import { authed, parseId, parseJson } from "@/server/http/api";
import { HttpError } from "@/server/http/errors";
import { sendMessageSchema } from "@/server/http/schemas";

type Params = { projectId: string; conversationId: string };

/**
 * Sends a user message and streams the model's answer as Server-Sent Events:
 *   event: meta  → ids, chosen model, routing reason, redaction count, context warnings
 *   event: delta → text chunk
 *   event: done  → finish reason, reported model version, token usage, latency
 *   event: error → { code, message }
 */
export const POST = authed<Params>(async (req, { user, params, meta }) => {
  const body = await parseJson(req, sendMessageSchema);
  const turn = runChatTurn({
    user,
    meta,
    projectId: parseId(params.projectId, "Project"),
    conversationId: parseId(params.conversationId, "Gesprek"),
    content: body.content,
    modelId: body.modelId,
    signal: req.signal,
  });

  // Pull the first event eagerly: access, routing and policy failures then surface as a
  // normal HTTP error response instead of an event inside a 200 stream.
  const first = await turn.next();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream already closed by the client.
        }
      };
      const emit = (ev: ChatTurnEvent) => send(ev.type, ev);
      try {
        if (!first.done) emit(first.value);
        for await (const ev of turn) emit(ev);
      } catch (err) {
        const e = err instanceof HttpError ? err : new HttpError(500, "internal", "Interne fout.");
        if (!(err instanceof HttpError)) console.error("[chat] stream error", err);
        send("error", { code: e.code, message: e.message });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    async cancel() {
      await turn.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
