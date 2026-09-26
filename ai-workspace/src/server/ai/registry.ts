import type { Classification } from "@/server/security/data-policy";

/**
 * Model catalog. One entry per selectable engine.
 *
 * `clearance` is a governance decision, not a technical fact: it states the most sensitive
 * data classification this model may receive, based on the contract with the provider (DPA,
 * data retention / zero-data-retention, training opt-out, hosting region). Review these values
 * with your compliance officer before processing client data. "restricted" is reserved for
 * engines where data never leaves your control (self-hosted / private deployments).
 *
 * `tags` feed the future automatic router (e.g. pick a "fast" model for titles, a
 * "reasoning" model for analysis, a different provider for QA to get an independent check).
 */
export interface ModelDefinition {
  id: string;
  provider: string;
  providerModel: string;
  label: string;
  description: string;
  contextWindowTokens: number;
  maxOutputTokens: number;
  clearance: Classification;
  tags: ReadonlyArray<"reasoning" | "fast" | "long-context" | "writing" | "coding" | "offline">;
}

export const MODEL_REGISTRY: ReadonlyArray<ModelDefinition> = [
  {
    id: "anthropic:claude-opus-5",
    provider: "anthropic",
    providerModel: "claude-opus-5",
    label: "Claude Opus 5",
    description: "Sterkste Claude-model voor analyse, redeneren en lange documenten.",
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 64_000,
    clearance: "confidential",
    tags: ["reasoning", "long-context", "writing", "coding"],
  },
  {
    id: "anthropic:claude-sonnet-5",
    provider: "anthropic",
    providerModel: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    description: "Snel en capabel; goede balans tussen kwaliteit en kosten.",
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 64_000,
    clearance: "confidential",
    tags: ["reasoning", "long-context", "writing", "coding"],
  },
  {
    id: "anthropic:claude-haiku-4-5",
    provider: "anthropic",
    providerModel: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    description: "Snelste en goedkoopste Claude-model voor eenvoudige taken.",
    contextWindowTokens: 200_000,
    maxOutputTokens: 32_000,
    clearance: "confidential",
    tags: ["fast"],
  },
  {
    // Verify context/output limits against OpenAI's model page before relying on them.
    id: "openai:gpt-5.5",
    provider: "openai",
    providerModel: "gpt-5.5",
    label: "GPT-5.5",
    description: "OpenAI's vlaggenschipmodel.",
    contextWindowTokens: 400_000,
    maxOutputTokens: 64_000,
    clearance: "confidential",
    tags: ["reasoning", "writing", "coding"],
  },
  {
    id: "openai:gpt-5.4-mini",
    provider: "openai",
    providerModel: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    description: "Snel en goedkoop OpenAI-model.",
    contextWindowTokens: 400_000,
    maxOutputTokens: 32_000,
    clearance: "confidential",
    tags: ["fast"],
  },
  {
    id: "mock:echo",
    provider: "mock",
    providerModel: "mock-echo-1",
    label: "Mock (offline echo)",
    description: "Lokale testprovider zonder API-key. Stuurt niets naar buiten.",
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 4_000,
    clearance: "restricted",
    tags: ["offline", "fast"],
  },
];

export function findModel(id: string): ModelDefinition | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}
