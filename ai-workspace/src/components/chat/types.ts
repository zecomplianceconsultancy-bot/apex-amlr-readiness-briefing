import type { UIHandoff } from "./handoff-card";

export interface Citation {
  url?: string;
  title?: string;
}

export interface MessageStats {
  invocationId: string;
  modelId: string | null;
  modelReported: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  finishReason: string | null;
  redactions?: number;
  citations?: Citation[];
  routing?: { strategy: string; reason: string };
}

export type StepStatus = "pending" | "running" | "complete" | "error" | "cancelled" | "skipped";

export interface UIStep {
  id: string;
  position: number;
  role: "answer" | "judge" | "research" | "draft" | "review" | "factcheck" | "final";
  modelId: string;
  label: string;
  status: StepStatus;
  text: string;
  verdict: string | null;
  error: string | null;
  invocationId: string | null;
  citations: Citation[];
  handoff?: UIHandoff | null;
}

export interface UIRun {
  id: string;
  kind: "compare" | "research";
  status: "running" | "complete" | "error" | "cancelled";
  steps: UIStep[];
}

export interface UIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "streaming" | "error" | "cancelled";
  stats?: MessageStats;
  warnings?: string[];
  run?: UIRun;
  handoff?: UIHandoff | null;
}
