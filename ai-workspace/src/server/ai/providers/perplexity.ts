import "server-only";
import OpenAI from "openai";
import { apiKey } from "@/server/settings/api-keys";
import { normalizeTurns, ProviderError, type AIProvider, type ChatRequest, type Citation, type FinishReason, type ProviderEvent } from "../types";

/**
 * Perplexity API (Sonar models): web search with sources, via its OpenAI-compatible
 * chat completions endpoint. Sources arrive as extra fields on the stream: `search_results`
 * ({ title, url, date }) and/or `citations` (URLs). Both are read defensively.
 * Verify model names and fields against docs.perplexity.ai when enabling the key.
 */
type PerplexityChunk = {
  id?: string;
  model?: string;
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  citations?: unknown;
  search_results?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
};

export function sourcesFrom(chunk: PerplexityChunk): Citation[] {
  if (Array.isArray(chunk.search_results)) {
    return chunk.search_results
      .filter((r): r is { url: string; title?: string } => typeof r === "object" && r !== null && typeof (r as { url?: unknown }).url === "string")
      .map((r) => ({ url: r.url, title: typeof r.title === "string" ? r.title : undefined }));
  }
  if (Array.isArray(chunk.citations)) return chunk.citations.filter((u): u is string => typeof u === "string").map((url) => ({ url }));
  return [];
}

function mapFinish(reason: string | null | undefined): FinishReason {
  if (reason === "stop") return "stop";
  if (reason === "length") return "length";
  if (reason === "content_filter") return "content_filter";
  return "other";
}

function mapError(err: unknown): ProviderError {
  const p = "perplexity";
  if (err instanceof ProviderError) return err;
  if (err instanceof OpenAI.APIUserAbortError) return new ProviderError(p, "cancelled", "Request cancelled");
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError(p, "timeout", err.message);
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError)
    return new ProviderError(p, "auth", "Perplexity heeft de API-key geweigerd.", err.status);
  if (err instanceof OpenAI.RateLimitError) return new ProviderError(p, "rate_limit", err.message, err.status);
  if (err instanceof OpenAI.BadRequestError || err instanceof OpenAI.NotFoundError) return new ProviderError(p, "bad_request", err.message, err.status);
  if (err instanceof OpenAI.InternalServerError || err instanceof OpenAI.APIConnectionError) return new ProviderError(p, "unavailable", err.message);
  if (err instanceof OpenAI.APIError) return new ProviderError(p, "unknown", err.message, err.status);
  return new ProviderError(p, "unknown", err instanceof Error ? err.message : String(err));
}

export class PerplexityProvider implements AIProvider {
  readonly id = "perplexity";
  readonly displayName = "Perplexity API";
  private client: OpenAI | undefined;

  /** `fetchImpl` is injectable for tests. */
  constructor(private readonly fetchImpl?: typeof fetch) {}

  isConfigured(): boolean {
    return Boolean(apiKey("perplexity"));
  }

  private clientKey: string | undefined;

  private getClient(): OpenAI {
    const key = apiKey("perplexity");
    if (!this.client || this.clientKey !== key) {
      this.client = new OpenAI({ apiKey: key, baseURL: "https://api.perplexity.ai", maxRetries: 2, fetch: this.fetchImpl });
      this.clientKey = key;
    }
    return this.client;
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<ProviderEvent> {
    try {
      const stream = await this.getClient().chat.completions.create(
        {
          model: req.providerModel,
          messages: [...(req.system ? [{ role: "system" as const, content: req.system }] : []), ...normalizeTurns(req.messages)],
          max_tokens: req.maxOutputTokens,
          stream: true,
        },
        { signal: req.signal },
      );
      let text = "";
      let sources: Citation[] = [];
      let finish: string | null = null;
      let model: string | null = null;
      let id: string | null = null;
      let usage: PerplexityChunk["usage"] = null;
      for await (const raw of stream) {
        const chunk = raw as unknown as PerplexityChunk;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          yield { type: "text", text: delta };
        }
        const found = sourcesFrom(chunk);
        if (found.length) sources = found;
        finish = chunk.choices?.[0]?.finish_reason ?? finish;
        model = chunk.model ?? model;
        id = chunk.id ?? id;
        usage = chunk.usage ?? usage;
      }
      yield {
        type: "done",
        result: {
          text,
          modelReported: model,
          finishReason: mapFinish(finish),
          rawFinishReason: finish,
          usage: { inputTokens: usage?.prompt_tokens ?? null, outputTokens: usage?.completion_tokens ?? null },
          providerRequestId: id,
          citations: sources,
        },
      };
    } catch (err) {
      throw mapError(err);
    }
  }
}
