import "server-only";
import { API_PROVIDER_INFO, apiKey, type ApiProvider } from "./api-keys";

export interface ApiTestResult {
  ok: boolean;
  message: string;
}

/**
 * Checks that the key works. Claude and OpenAI: list models (free). Perplexity has no free
 * check, so it sends one tiny question (costs well under $0.02).
 */
export async function testApiKey(p: ApiProvider, fetchImpl: typeof fetch = fetch): Promise<ApiTestResult> {
  const key = apiKey(p);
  const label = API_PROVIDER_INFO[p].label;
  if (!key) return { ok: false, message: `Nog geen sleutel voor ${label} opgeslagen.` };
  const req =
    p === "anthropic"
      ? fetchImpl("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } })
      : p === "openai"
        ? fetchImpl("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } })
        : fetchImpl("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
            body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: "Antwoord alleen met: ok" }], max_tokens: 5 }),
          });
  let res: Response;
  try {
    res = await Promise.race([req, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000))]);
  } catch {
    return { ok: false, message: `Geen verbinding met ${label}. Controleer je internetverbinding en probeer opnieuw.` };
  }
  if (res.ok) return { ok: true, message: `Verbonden met ${label}. Je kunt de ${label}-modellen nu kiezen.` };
  if (res.status === 401 || res.status === 403) return { ok: false, message: `${label} weigert deze sleutel. Maak een nieuwe sleutel aan en plak hem opnieuw.` };
  if (res.status === 402) return { ok: false, message: `De sleutel werkt, maar er is geen tegoed. Koop eerst tegoed (stap 2).` };
  if (res.status === 429) return { ok: false, message: `${label} meldt te veel verzoeken of onvoldoende tegoed. Controleer je tegoed en probeer het over een minuut opnieuw.` };
  const body = await res.text().catch(() => "");
  if (/credit|balance|billing|quota/i.test(body)) return { ok: false, message: `De sleutel werkt, maar er is geen (of te weinig) tegoed. Koop eerst tegoed (stap 2).` };
  return { ok: false, message: `${label} gaf een onverwachte fout (${res.status}). Probeer het later opnieuw.` };
}
