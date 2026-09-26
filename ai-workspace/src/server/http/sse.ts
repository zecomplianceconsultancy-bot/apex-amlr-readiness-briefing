import "server-only";
import { HttpError } from "./errors";

/**
 * Streams a generator of `{ type, ... }` events as Server-Sent Events.
 * The first event is pulled eagerly by the caller so that access, validation and policy errors
 * surface as normal HTTP errors instead of an error event inside a 200 stream.
 */
export async function sseResponse<T extends { type: string }>(gen: AsyncGenerator<T>): Promise<Response> {
  const first = await gen.next();
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
      try {
        if (!first.done) send(first.value.type, first.value);
        for await (const ev of gen) send(ev.type, ev);
      } catch (err) {
        const e = err instanceof HttpError ? err : new HttpError(500, "internal", "Interne fout.");
        if (!(err instanceof HttpError)) console.error("[sse] stream error", err);
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
      await gen.return(undefined);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
