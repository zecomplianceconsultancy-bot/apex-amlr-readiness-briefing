import "server-only";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { env } from "@/server/config/env";

/**
 * Declarative description of an AI tool's web interface. The browser engine is generic;
 * everything site-specific lives here, so when a site changes its layout only these selectors
 * need an update — in code, or without a code change via BROWSER_SITES_FILE.
 *
 * Selectors are comma-separated alternatives (CSS). They are best-effort and MUST be verified
 * with the "Check" button on the Browser-tools page: web UIs change without notice.
 */
export const SiteProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  /** Page that starts a fresh conversation. */
  newChatUrl: z.url(),
  /** Prompt input: a <textarea> or a contenteditable element. */
  input: z.string(),
  /** Send button. When absent or not found, Enter is pressed. */
  submit: z.string().optional(),
  /** Assistant answer blocks; the last match is the current answer. */
  response: z.string(),
  /** Present while the tool is still generating (typically the stop button). */
  generating: z.string().optional(),
  /** Source links, searched inside the last answer and in `citationsScope` if given. */
  citations: z.string().optional(),
  citationsScope: z.string().optional(),
  /** Longest prompt we attempt to type into this UI. */
  maxPromptChars: z.number().int().positive(),
  /**
   * URL that opens the tool with the question pre-filled ("{q}" = URL-encoded question). Used by
   * the manual bridge in the user's own browser; long questions are pasted instead.
   */
  prefillUrl: z.string().optional(),
  /** Answer is considered final when its text is unchanged for this long. */
  stableMs: z.number().int().positive().default(2000),
});
export type SiteProfile = z.infer<typeof SiteProfileSchema>;

const BUILT_IN: SiteProfile[] = [
  {
    id: "perplexity",
    label: "Perplexity",
    newChatUrl: "https://www.perplexity.ai/",
    prefillUrl: "https://www.perplexity.ai/search?q={q}",
    input: '#ask-input, textarea[placeholder], div[contenteditable="true"]',
    submit: 'button[aria-label="Submit"], button[data-testid="submit-button"]',
    response: '[id^="markdown-content"], div.prose',
    generating: 'button[aria-label="Stop"], button[data-testid="stop-generating-response-button"]',
    citations: 'a[href^="http"]:not([href*="perplexity.ai"])',
    maxPromptChars: 30_000,
    stableMs: 2500,
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    newChatUrl: "https://chatgpt.com/",
    prefillUrl: "https://chatgpt.com/?q={q}",
    input: '#prompt-textarea, div[contenteditable="true"]',
    submit: 'button[data-testid="send-button"], #composer-submit-button',
    response: '[data-message-author-role="assistant"]',
    generating: 'button[data-testid="stop-button"]',
    citations: 'a[href^="http"]:not([href*="chatgpt.com"]):not([href*="openai.com"])',
    maxPromptChars: 60_000,
    stableMs: 2000,
  },
  {
    id: "claude",
    label: "Claude",
    newChatUrl: "https://claude.ai/new",
    prefillUrl: "https://claude.ai/new?q={q}",
    input: 'div[contenteditable="true"].ProseMirror, div[contenteditable="true"]',
    submit: 'button[aria-label="Send message"], button[aria-label="Send Message"]',
    response: ".font-claude-response, [data-is-streaming]",
    generating: '[data-is-streaming="true"], button[aria-label="Stop response"]',
    citations: 'a[href^="http"]:not([href*="claude.ai"]):not([href*="anthropic.com"])',
    maxPromptChars: 100_000,
    stableMs: 2000,
  },
  {
    id: "gemini",
    label: "Gemini",
    newChatUrl: "https://gemini.google.com/app",
    input: 'rich-textarea div[contenteditable="true"], div.ql-editor[contenteditable="true"]',
    submit: 'button[aria-label="Send message"], button.send-button',
    response: "message-content, model-response",
    generating: 'button[aria-label="Stop response"]',
    citations: 'a[href^="http"]:not([href*="google.com"])',
    maxPromptChars: 60_000,
    stableMs: 2500,
  },
];

const extraSites = new Map<string, SiteProfile>();

/** Test hook: register an additional site (e.g. a local fixture page). */
export function registerSite(profile: SiteProfile): void {
  extraSites.set(profile.id, SiteProfileSchema.parse(profile));
}

function loadOverrides(): Record<string, Partial<SiteProfile>> {
  const file = env().BROWSER_SITES_FILE;
  if (!file) return {};
  const parsed = z.record(z.string(), SiteProfileSchema.partial()).safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error(`Invalid ${file}: ${parsed.error.message}`);
  return parsed.data;
}

export function listSites(): SiteProfile[] {
  const overrides = loadOverrides();
  return [...BUILT_IN, ...extraSites.values()].map((s) => SiteProfileSchema.parse({ ...s, ...overrides[s.id] }));
}

export function getSite(id: string): SiteProfile | undefined {
  return listSites().find((s) => s.id === id);
}
