import type { CapabilityTag } from "@/lib/strengths";
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
  /** Capability tags; drive automatic routing and default role assignment (lib/strengths.ts). */
  tags: ReadonlyArray<CapabilityTag>;
  /** Plain-language strengths, shown in the model pickers. */
  strengths: string;
  /** How the engine is reached: official API, or the tool's web UI in a desktop browser. */
  transport: "api" | "browser" | "manual" | "local";
  /** Upper bound for the whole prompt in characters (browser UIs have input limits). */
  maxInputChars?: number;
}

/**
 * Browser transport (phase 1, no APIs). Clearance is "internal": consumer web tools may retain
 * or train on input depending on account settings, so client data (confidential/restricted
 * projects) never goes this way. Turn off "improve the model"/training in each tool.
 */
const browserModel = (
  id: string,
  label: string,
  description: string,
  maxInputChars: number,
  tags: ModelDefinition["tags"],
  strengths: string,
): ModelDefinition => ({
  id: `browser:${id}`,
  provider: "browser",
  providerModel: id,
  label: `${label} (browser)`,
  description,
  contextWindowTokens: Math.round(maxInputChars / 4),
  maxOutputTokens: 16_000,
  clearance: "internal",
  tags,
  strengths,
  transport: "browser",
  maxInputChars,
});

/**
 * Manual bridge: same tools, but the user sends the question in their own browser and pastes
 * the answer back. For tools that block automated browsers (e.g. a "verify you are human" check).
 */
const manualModel = (id: string, label: string, maxInputChars: number, tags: ModelDefinition["tags"], strengths: string): ModelDefinition => ({
  id: `manual:${id}`,
  provider: "manual",
  providerModel: id,
  label: `${label} (handmatig)`,
  description: `Je stuurt de vraag zelf in ${label} in je eigen browser en plakt het antwoord terug.`,
  contextWindowTokens: Math.round(maxInputChars / 4),
  maxOutputTokens: 16_000,
  clearance: "internal",
  tags: [...tags, "manual"],
  strengths: `${strengths} — jij plakt`,
  transport: "manual",
  maxInputChars,
});

export const MODEL_REGISTRY: ReadonlyArray<ModelDefinition> = [
  browserModel("perplexity", "Perplexity", "perplexity.ai in je browser.", 30_000, ["sources", "web-research"], "Actueel webonderzoek met bronvermelding"),
  browserModel(
    "chatgpt",
    "ChatGPT",
    "chatgpt.com in je browser (model volgens je ChatGPT-instelling).",
    60_000,
    ["structure", "writing", "reasoning", "data-analysis", "images"],
    "Gestructureerd uitwerken en schrijven, data/Excel-analyse, afbeeldingen",
  ),
  browserModel(
    "claude",
    "Claude",
    "claude.ai in je browser (model volgens je Claude-instelling).",
    100_000,
    ["critical-review", "reasoning", "long-context", "writing"],
    "Kritische analyse, nuance en lange documenten",
  ),
  browserModel(
    "gemini",
    "Gemini",
    "gemini.google.com in je browser.",
    60_000,
    ["fact-check", "images", "images-pro", "web-research", "long-context", "reasoning"],
    "Feitencheck met Google Zoeken, afbeeldingen maken, zeer lange context",
  ),
  manualModel("perplexity", "Perplexity", 30_000, ["sources", "web-research"], "Actueel webonderzoek met bronvermelding"),
  manualModel("chatgpt", "ChatGPT", 60_000, ["structure", "writing", "reasoning", "data-analysis", "images"], "Uitwerken en schrijven, data/Excel-analyse, afbeeldingen"),
  manualModel("claude", "Claude", 100_000, ["critical-review", "reasoning", "long-context", "writing"], "Kritische analyse en nuance"),
  manualModel("gemini", "Gemini", 60_000, ["fact-check", "images", "images-pro", "web-research", "long-context", "reasoning"], "Feitencheck met Google Zoeken, afbeeldingen maken"),
  {
    // Clearance "internal" until the Perplexity API data-processing terms are reviewed.
    id: "perplexity:sonar-pro",
    provider: "perplexity",
    providerModel: "sonar-pro",
    label: "Perplexity Sonar Pro (API)",
    description: "Perplexity via de officiële API: webonderzoek met bronnen, volledig automatisch.",
    contextWindowTokens: 200_000,
    maxOutputTokens: 8_000,
    clearance: "internal",
    tags: ["sources", "web-research"],
    strengths: "Actueel webonderzoek met bronvermelding",
    transport: "api",
  },
  {
    id: "perplexity:sonar",
    provider: "perplexity",
    providerModel: "sonar",
    label: "Perplexity Sonar (API)",
    description: "Snelle en goedkope Perplexity-zoekvraag via de API.",
    contextWindowTokens: 128_000,
    maxOutputTokens: 8_000,
    clearance: "internal",
    tags: ["web-research", "fast"],
    strengths: "Snel webonderzoek met bronnen",
    transport: "api",
  },
  {
    id: "anthropic:claude-opus-5",
    provider: "anthropic",
    providerModel: "claude-opus-5",
    label: "Claude Opus 5",
    description: "Sterkste Claude-model voor analyse, redeneren en lange documenten.",
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 64_000,
    clearance: "confidential",
    tags: ["critical-review", "reasoning", "long-context", "writing", "coding"],
    strengths: "Diepgaande analyse, kritische review, lange documenten",
    transport: "api",
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
    tags: ["reasoning", "writing", "long-context", "coding"],
    strengths: "Snel en sterk in analyse en schrijven",
    transport: "api",
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
    strengths: "Snel en goedkoop voor eenvoudige taken",
    transport: "api",
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
    tags: ["structure", "writing", "reasoning", "coding"],
    strengths: "Gestructureerd uitwerken, schrijven en redeneren",
    transport: "api",
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
    strengths: "Snel en goedkoop voor eenvoudige taken",
    transport: "api",
  },
  {
    id: "mock:echo",
    provider: "mock",
    providerModel: "mock-echo-1",
    label: "Mock A (offline)",
    description: "Lokale testprovider zonder API-key. Stuurt niets naar buiten.",
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 4_000,
    clearance: "restricted",
    tags: ["offline", "fast"],
    strengths: "Offline test",
    transport: "local",
  },
  {
    id: "mock:critic",
    provider: "mock",
    providerModel: "mock-critic-1",
    label: "Mock B (offline)",
    description: "Tweede lokale testprovider, om vergelijken en workflows offline te proberen.",
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 4_000,
    clearance: "restricted",
    tags: ["offline", "critical-review"],
    strengths: "Offline test (rol: criticus)",
    transport: "local",
  },
];

export function findModel(id: string): ModelDefinition | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id);
}
