import "server-only";
import { env } from "@/server/config/env";
import { runOnPage } from "../browser/engine";
import { acquireSite, pageFor, recordSiteStatus } from "../browser/session";
import { getSite } from "../browser/sites";
import { ProviderError, type AIProvider, type ChatMessage, type ChatRequest, type ProviderEvent } from "../types";

/**
 * Web UIs are single-input chat boxes, so system instructions, project documents and our own
 * conversation history are flattened into one prompt. The question goes last.
 */
export function flattenPrompt(system: string | undefined, messages: ChatMessage[]): string {
  const history = messages.slice(0, -1);
  const last = messages.at(-1);
  const parts: string[] = [];
  if (system) parts.push(`<instructions>\n${system}\n</instructions>`);
  if (history.length) {
    parts.push(`<previous_conversation>\n${history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")}\n</previous_conversation>`);
  }
  parts.push(last?.content ?? "");
  return parts.join("\n\n");
}

/**
 * Browser transport: drives an AI tool's normal web interface on the user's desktop.
 * `providerModel` is the site id from ../browser/sites.ts.
 */
export class BrowserProvider implements AIProvider {
  readonly id = "browser";
  readonly displayName = "Browser (desktop)";

  isConfigured(): boolean {
    return env().ENABLE_BROWSER_PROVIDER;
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<ProviderEvent> {
    const site = getSite(req.providerModel);
    if (!site) throw new ProviderError("browser", "bad_request", `Onbekende browser-tool: ${req.providerModel}`);
    const prompt = flattenPrompt(req.system, req.messages);
    if (prompt.length > site.maxPromptChars) {
      throw new ProviderError(
        "browser",
        "bad_request",
        `Prompt (${prompt.length} tekens) is te lang voor ${site.label} via de browser (max ${site.maxPromptChars}). Zet minder bestanden in context.`,
      );
    }

    const release = await acquireSite(site.id);
    try {
      const page = await pageFor(site.id);
      await page.bringToFront().catch(() => undefined);
      for await (const event of runOnPage(page, site, prompt, { signal: req.signal, answerTimeoutMs: env().BROWSER_ANSWER_TIMEOUT_SEC * 1000 })) {
        if (event.type === "done") recordSiteStatus(site.id, { state: "ready", checkedAt: new Date().toISOString(), url: page.url() });
        yield event;
      }
    } catch (err) {
      if (err instanceof ProviderError && (err.code === "auth" || err.code === "human_check")) {
        recordSiteStatus(site.id, { state: err.code === "auth" ? "login_required" : "human_check", checkedAt: new Date().toISOString(), detail: err.message });
      }
      if (err instanceof ProviderError) throw err;
      throw new ProviderError("browser", "unavailable", err instanceof Error ? err.message.split("\n")[0]! : String(err));
    } finally {
      release();
    }
  }
}
