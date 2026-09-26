import "server-only";
import { getSite } from "../browser/sites";
import { openHandoff } from "../handoff";
import { ProviderError, type AIProvider, type ChatRequest, type Citation, type ProviderEvent } from "../types";
import { flattenPrompt } from "./browser";

/** Longest question we put in a URL; longer ones are copied to the clipboard instead. */
const MAX_PREFILL_CHARS = 1_500;

/** URLs in pasted text (plain or markdown links) become the answer's sources. */
export function extractCitations(text: string): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const m of text.matchAll(/\[([^\]]{1,200})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')\]]+)/g)) {
    const url = (m[2] ?? m[3] ?? "").replace(/[.,;:]+$/, "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: m[1]?.trim() || undefined });
  }
  return out.slice(0, 50);
}

/**
 * Manual bridge: the user runs the step in the tool's normal website in their own browser.
 * The workspace prepares the (masked) prompt, opens the tool, and waits for the pasted answer.
 * No automation touches the tool's website, so bot protection and site terms are respected,
 * while the workspace still records context, prompt, answer, sources and audit trail.
 */
export class ManualProvider implements AIProvider {
  readonly id = "manual";
  readonly displayName = "Handmatig (jij plakt)";

  isConfigured(): boolean {
    return true;
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<ProviderEvent> {
    const site = getSite(req.providerModel);
    if (!site) throw new ProviderError("manual", "bad_request", `Onbekende tool: ${req.providerModel}`);
    if (!req.context?.userId) throw new ProviderError("manual", "bad_request", "Geen gebruiker bekend voor handmatige stap.");

    const prompt = flattenPrompt(req.system, req.messages);
    const prefilled = Boolean(site.prefillUrl) && prompt.length <= MAX_PREFILL_CHARS;
    const openUrl = prefilled ? site.prefillUrl!.replace("{q}", encodeURIComponent(prompt)) : site.newChatUrl;

    const { id, answer } = openHandoff(req.context.userId, req.signal);
    yield { type: "handoff", handoff: { handoffId: id, tool: site.id, toolLabel: site.label, prompt, openUrl, prefilled } };

    const text = (await answer).trim();
    if (!text) throw new ProviderError("manual", "bad_request", "Leeg antwoord geplakt.");
    yield { type: "text", text };
    yield {
      type: "done",
      result: {
        text,
        modelReported: `${site.id}-handmatig`,
        finishReason: "stop",
        rawFinishReason: "pasted-by-user",
        usage: { inputTokens: null, outputTokens: null },
        providerRequestId: null,
        citations: extractCitations(text),
      },
    };
  }
}
