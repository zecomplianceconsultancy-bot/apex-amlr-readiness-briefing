import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/server/config/env";
import {
  normalizeTurns,
  ProviderError,
  type AIProvider,
  type ChatRequest,
  type FinishReason,
  type ProviderEvent,
} from "../types";

function mapStopReason(reason: string | null): FinishReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

function mapError(err: unknown): ProviderError {
  const p = "anthropic";
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError(p, "cancelled", "Request cancelled");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError(p, "timeout", err.message);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return new ProviderError(p, "auth", "Anthropic heeft de API-key geweigerd.", err.status);
  if (err instanceof Anthropic.RateLimitError) return new ProviderError(p, "rate_limit", err.message, err.status);
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError)
    return new ProviderError(p, "bad_request", err.message, err.status);
  if (err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError)
    return new ProviderError(p, "unavailable", err.message);
  if (err instanceof Anthropic.APIError) return new ProviderError(p, "unknown", err.message, err.status);
  return new ProviderError(p, "unknown", err instanceof Error ? err.message : String(err));
}

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly displayName = "Anthropic (Claude)";
  private client: Anthropic | undefined;

  isConfigured(): boolean {
    return Boolean(env().ANTHROPIC_API_KEY);
  }

  private getClient(): Anthropic {
    this.client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 2 });
    return this.client;
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<ProviderEvent> {
    try {
      const stream = this.getClient().messages.stream(
        {
          model: req.providerModel,
          max_tokens: req.maxOutputTokens,
          // The system prompt carries project instructions and documents and is identical across
          // turns, so automatic prompt caching makes follow-up turns much cheaper.
          cache_control: { type: "ephemeral" },
          ...(req.system ? { system: req.system } : {}),
          messages: normalizeTurns(req.messages),
        },
        { signal: req.signal },
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", text: event.delta.text };
        }
      }
      const final = await stream.finalMessage();
      const text = final.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const u = final.usage;
      yield {
        type: "done",
        result: {
          text,
          modelReported: final.model,
          finishReason: mapStopReason(final.stop_reason),
          rawFinishReason: final.stop_reason,
          usage: {
            inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
            outputTokens: u.output_tokens,
          },
          providerRequestId: final.id,
          citations: [],
        },
      };
    } catch (err) {
      throw mapError(err);
    }
  }
}
