/**
 * Provider Abstraction Layer — the contract every AI engine implements.
 *
 * The rest of the application only speaks these normalized types. Provider SDK types never
 * leak past an adapter, so adding, replacing or removing a provider touches one file in
 * ./providers plus a registry entry.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  /** Provider-side model name, e.g. "claude-opus-5" or "gpt-5.5". */
  providerModel: string;
  system?: string;
  messages: ChatMessage[];
  maxOutputTokens: number;
  signal?: AbortSignal;
  /** Who is asking; needed by engines that hand work to the user (manual bridge). */
  context?: { userId: string };
}

export type FinishReason = "stop" | "length" | "refusal" | "content_filter" | "other";

/** Source reference returned by research-capable providers (web search, retrieval). */
export interface Citation {
  url?: string;
  title?: string;
  fileId?: string;
  quote?: string;
}

export interface ChatResult {
  text: string;
  /** Model/version the provider says actually served the request. */
  modelReported: string | null;
  finishReason: FinishReason;
  /** Provider's own finish/stop reason, kept verbatim for the audit trail. */
  rawFinishReason: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null };
  providerRequestId: string | null;
  citations: Citation[];
}

/** The user does this step by hand in their own browser (manual bridge). */
export interface Handoff {
  handoffId: string;
  tool: string;
  toolLabel: string;
  prompt: string;
  /** Opens the tool; with the question pre-filled when the tool supports that and it fits in a URL. */
  openUrl: string;
  prefilled: boolean;
}

export type ProviderEvent = { type: "text"; text: string } | { type: "handoff"; handoff: Handoff } | { type: "done"; result: ChatResult };

export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  /** True when credentials are present. Unconfigured providers are shown but not selectable. */
  isConfigured(): boolean;
  streamChat(req: ChatRequest): AsyncGenerator<ProviderEvent>;
}

export type ProviderErrorCode =
  | "auth"
  | "human_check"
  | "rate_limit"
  | "bad_request"
  | "timeout"
  | "unavailable"
  | "cancelled"
  | "unknown";

export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly code: ProviderErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }

  get retryable(): boolean {
    return this.code === "rate_limit" || this.code === "timeout" || this.code === "unavailable";
  }
}

/** Merge consecutive same-role turns; some providers require strict alternation. */
export function normalizeTurns(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`;
    else out.push({ ...m });
  }
  // Conversations must start with a user turn.
  while (out[0]?.role === "assistant") out.shift();
  return out;
}
