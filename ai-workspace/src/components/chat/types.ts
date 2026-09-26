export interface MessageStats {
  invocationId: string;
  modelId: string | null;
  modelReported: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  finishReason: string | null;
  redactions?: number;
  routing?: { strategy: string; reason: string };
}

export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "streaming" | "error" | "cancelled";
  stats?: MessageStats;
  warnings?: string[];
}
