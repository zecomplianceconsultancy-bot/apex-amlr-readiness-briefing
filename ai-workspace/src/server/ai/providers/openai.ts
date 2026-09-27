import "server-only";
import OpenAI from "openai";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import { apiKey } from "@/server/settings/api-keys";
import {
  normalizeTurns,
  ProviderError,
  type AIProvider,
  type ChatRequest,
  type FinishReason,
  type ProviderEvent,
} from "../types";

function mapError(err: unknown): ProviderError {
  const p = "openai";
  if (err instanceof ProviderError) return err;
  if (err instanceof OpenAI.APIUserAbortError) return new ProviderError(p, "cancelled", "Request cancelled");
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError(p, "timeout", err.message);
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError)
    return new ProviderError(p, "auth", "OpenAI heeft de API-key geweigerd.", err.status);
  if (err instanceof OpenAI.RateLimitError) return new ProviderError(p, "rate_limit", err.message, err.status);
  if (err instanceof OpenAI.BadRequestError || err instanceof OpenAI.NotFoundError)
    return new ProviderError(p, "bad_request", err.message, err.status);
  if (err instanceof OpenAI.InternalServerError || err instanceof OpenAI.APIConnectionError)
    return new ProviderError(p, "unavailable", err.message);
  if (err instanceof OpenAI.APIError) return new ProviderError(p, "unknown", err.message, err.status);
  return new ProviderError(p, "unknown", err instanceof Error ? err.message : String(err));
}

function finishReason(res: OpenAIResponse, refused: boolean): { reason: FinishReason; raw: string | null } {
  if (refused) return { reason: "refusal", raw: "refusal" };
  if (res.status === "completed") return { reason: "stop", raw: "completed" };
  const detail = res.incomplete_details?.reason ?? null;
  if (detail === "max_output_tokens") return { reason: "length", raw: detail };
  if (detail === "content_filter") return { reason: "content_filter", raw: detail };
  return { reason: "other", raw: detail ?? res.status ?? null };
}

export class OpenAIProvider implements AIProvider {
  readonly id = "openai";
  readonly displayName = "OpenAI";
  private client: OpenAI | undefined;

  isConfigured(): boolean {
    return Boolean(apiKey("openai"));
  }

  private clientKey: string | undefined;

  private getClient(): OpenAI {
    const key = apiKey("openai");
    if (!this.client || this.clientKey !== key) {
      this.client = new OpenAI({ apiKey: key, maxRetries: 2 });
      this.clientKey = key;
    }
    return this.client;
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<ProviderEvent> {
    try {
      const stream = await this.getClient().responses.create(
        {
          model: req.providerModel,
          instructions: req.system ?? null,
          input: normalizeTurns(req.messages).map((m) => ({ role: m.role, content: m.content })),
          max_output_tokens: req.maxOutputTokens,
          // Data minimisation: do not let OpenAI retain the response for later retrieval.
          store: false,
          stream: true,
        },
        { signal: req.signal },
      );

      let text = "";
      let refused = false;
      let final: OpenAIResponse | undefined;
      for await (const event of stream) {
        switch (event.type) {
          case "response.output_text.delta":
            text += event.delta;
            yield { type: "text", text: event.delta };
            break;
          case "response.refusal.delta":
            refused = true;
            text += event.delta;
            yield { type: "text", text: event.delta };
            break;
          case "response.completed":
          case "response.incomplete":
            final = event.response;
            break;
          case "response.failed":
            throw new ProviderError("openai", "unavailable", event.response.error?.message ?? "Response failed");
          case "error":
            throw new ProviderError("openai", "unknown", event.message);
        }
      }
      if (!final) throw new ProviderError("openai", "unknown", "Stream ended without a final response");
      const fr = finishReason(final, refused);
      yield {
        type: "done",
        result: {
          text,
          modelReported: final.model,
          finishReason: fr.reason,
          rawFinishReason: fr.raw,
          usage: { inputTokens: final.usage?.input_tokens ?? null, outputTokens: final.usage?.output_tokens ?? null },
          providerRequestId: final.id,
          citations: [],
        },
      };
    } catch (err) {
      throw mapError(err);
    }
  }
}
