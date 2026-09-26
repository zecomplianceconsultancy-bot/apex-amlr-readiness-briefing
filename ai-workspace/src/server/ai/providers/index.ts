import "server-only";
import { env } from "@/server/config/env";
import type { AIProvider } from "../types";
import { AnthropicProvider } from "./anthropic";
import { BrowserProvider } from "./browser";
import { ManualProvider } from "./manual";
import { MockProvider } from "./mock";
import { OpenAIProvider } from "./openai";
import { PerplexityProvider } from "./perplexity";

/**
 * Provider registry. To add an engine (Gemini, Mistral, a self-hosted model, Perplexity, a
 * research pipeline, ...): implement AIProvider in a new file, register it here and add its
 * models to ../registry.ts. Nothing else in the application changes.
 */
const providers: Record<string, AIProvider> = {
  browser: new BrowserProvider(),
  manual: new ManualProvider(),
  perplexity: new PerplexityProvider(),
  anthropic: new AnthropicProvider(),
  openai: new OpenAIProvider(),
  mock: new MockProvider(() => env().ENABLE_MOCK_PROVIDER),
};

export function getProvider(id: string): AIProvider | undefined {
  return providers[id];
}

export function listProviders(): AIProvider[] {
  return Object.values(providers);
}
