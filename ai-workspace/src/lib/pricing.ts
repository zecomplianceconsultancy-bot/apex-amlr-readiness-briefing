/**
 * Price reference for the "Kosten & gebruik" page. Public list prices in USD, excluding VAT,
 * as checked in September 2026. Prices change: always verify on the vendor's own site.
 */

export const PRICES_CHECKED = "september 2026";

export interface Plan {
  name: string;
  price: string;
  note?: string;
}

export interface ApiPrice {
  model: string;
  /** USD per million input tokens / output tokens. */
  input: number;
  output: number;
  note?: string;
}

export interface ToolPricing {
  tool: "perplexity" | "chatgpt" | "claude" | "gemini";
  label: string;
  bestFor: string;
  plans: Plan[];
  api: ApiPrice[];
  /** API model used to estimate "what would my usage cost via the API". */
  reference: ApiPrice;
  pricingUrl: string;
}

const claudeSonnet: ApiPrice = { model: "Claude Sonnet 5", input: 2, output: 10 };
const gpt55: ApiPrice = { model: "GPT-5.5", input: 5, output: 30 };
const sonarPro: ApiPrice = { model: "Sonar Pro", input: 3, output: 15, note: "plus zoekkosten per aanvraag" };
const gemini31Pro: ApiPrice = { model: "Gemini 3.1 Pro", input: 2, output: 12, note: "tot 200K tokens invoer" };

export const TOOL_PRICING: ToolPricing[] = [
  {
    tool: "perplexity",
    label: "Perplexity",
    bestFor: "Zoeken en actuele informatie met bronnen",
    plans: [
      { name: "Free", price: "$0", note: "beperkt aantal Pro-zoekopdrachten" },
      { name: "Pro", price: "$20 / maand" },
      { name: "Max", price: "$200 / maand" },
    ],
    api: [{ model: "Sonar", input: 1, output: 1, note: "plus zoekkosten per aanvraag" }, sonarPro],
    reference: sonarPro,
    pricingUrl: "https://www.perplexity.ai/pro",
  },
  {
    tool: "chatgpt",
    label: "ChatGPT",
    bestFor: "Schrijven en uitwerken, data/Excel, afbeeldingen",
    plans: [
      { name: "Free", price: "$0" },
      { name: "Go", price: "$8 / maand" },
      { name: "Plus", price: "$20 / maand" },
      { name: "Pro", price: "$100 of $200 / maand" },
      { name: "Business", price: "$25 / gebruiker / maand", note: "$20 bij jaarbetaling, min. 2 gebruikers" },
    ],
    api: [gpt55],
    reference: gpt55,
    pricingUrl: "https://openai.com/chatgpt/pricing/",
  },
  {
    tool: "claude",
    label: "Claude",
    bestFor: "Kritisch beoordelen, nuance, lange documenten",
    plans: [
      { name: "Free", price: "$0" },
      { name: "Pro", price: "$20 / maand" },
      { name: "Max", price: "$100 of $200 / maand" },
      { name: "Team", price: "$25 / gebruiker / maand", note: "$20 bij jaarbetaling, min. 5 gebruikers" },
    ],
    api: [{ model: "Claude Opus 5", input: 5, output: 25 }, claudeSonnet, { model: "Claude Haiku 4.5", input: 1, output: 5 }],
    reference: claudeSonnet,
    pricingUrl: "https://claude.com/pricing",
  },
  {
    tool: "gemini",
    label: "Gemini",
    bestFor: "Feitencheck met Google Zoeken, afbeeldingen, lange context",
    plans: [
      { name: "Free", price: "$0" },
      { name: "Google AI Plus", price: "$7,99 / maand" },
      { name: "Google AI Pro", price: "$19,99 / maand", note: "in NL ca. €219,99 per jaar" },
      { name: "Google AI Ultra", price: "$99,99 / maand" },
    ],
    api: [gemini31Pro, { model: "Gemini 3.5 Flash-Lite", input: 0.3, output: 2.5 }],
    reference: gemini31Pro,
    pricingUrl: "https://one.google.com/about/google-ai-plans/",
  },
];

/**
 * Per-model API list prices (USD per million tokens, plus an estimated per-request search fee),
 * used for the monthly budget. Perplexity's search fee depends on search depth: the highest
 * tier is used, so the estimate errs on the safe side.
 */
export const MODEL_API_PRICES: Record<string, { input: number; output: number; perRequest?: number }> = {
  "anthropic:claude-opus-5": { input: 5, output: 25 },
  "anthropic:claude-sonnet-5": { input: 2, output: 10 },
  "anthropic:claude-haiku-4-5": { input: 1, output: 5 },
  "perplexity:sonar-pro": { input: 3, output: 15, perRequest: 0.014 },
  "perplexity:sonar": { input: 1, output: 1, perRequest: 0.012 },
  "openai:gpt-5.5": { input: 5, output: 30 },
};
/** Unknown models are priced like the provider's most expensive one (again: safe side). */
export function modelApiPrice(modelId: string): { input: number; output: number; perRequest?: number } {
  const known = MODEL_API_PRICES[modelId];
  if (known) return known;
  const provider = modelId.split(":")[0];
  const same = Object.entries(MODEL_API_PRICES).filter(([id]) => id.startsWith(`${provider}:`)).map(([, p]) => p);
  return same.sort((a, b) => b.output - a.output)[0] ?? { input: 5, output: 30 };
}

/** Rough token estimate from characters (≈ 4 characters per token). */
export const tokensFromChars = (chars: number) => Math.ceil(chars / 4);

export function apiCost(price: ApiPrice, inputTokens: number, outputTokens: number): number {
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export function formatUsd(n: number): string {
  return n < 0.01 && n > 0 ? "< $0,01" : `$${n.toFixed(2).replace(".", ",")}`;
}
