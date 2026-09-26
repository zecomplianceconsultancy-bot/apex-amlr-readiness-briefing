import type { Page } from "playwright";
import { ProviderError, type Citation, type ProviderEvent } from "../types";
import type { SiteProfile } from "./sites";

const POLL_MS = 400;

function cancelled(): ProviderError {
  return new ProviderError("browser", "cancelled", "Request cancelled");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(cancelled());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface EngineOptions {
  signal?: AbortSignal;
  answerTimeoutMs: number;
  inputTimeoutMs?: number;
  firstResponseTimeoutMs?: number;
}

/**
 * Generic "type a prompt into a chat UI and read the answer" engine.
 *
 * Starts a fresh conversation in the tool for every call: the workspace — not the tool — is
 * the system of record for history and context. Streams the answer by polling the text of the
 * newest answer block; the answer is final when the tool no longer shows its "generating"
 * indicator and the text has been stable for `site.stableMs`.
 */
export async function* runOnPage(page: Page, site: SiteProfile, prompt: string, opts: EngineOptions): AsyncGenerator<ProviderEvent> {
  const { signal } = opts;
  if (signal?.aborted) throw cancelled();

  await page.goto(site.newChatUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const input = page.locator(site.input).first();
  const waitInput = (timeout: number) => input.waitFor({ state: "visible", timeout }).then(() => true, () => false);
  let found = await waitInput(opts.inputTimeoutMs ?? 20_000);
  if (!found && !signal?.aborted) {
    // Slow or half-loaded page: one reload before concluding we are logged out.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    found = await waitInput(opts.inputTimeoutMs ?? 20_000);
  }
  if (!found) {
    throw new ProviderError("browser", "auth", `${site.label}: invoerveld niet gevonden. Log in via Browser-tools, of de pagina is gewijzigd (selectors bijwerken).`);
  }

  const answers = page.locator(site.response);
  const before = await answers.count();

  await input.click();
  const tag = await input.evaluate((el) => el.tagName);
  if (tag === "TEXTAREA" || tag === "INPUT") await input.fill(prompt);
  else await page.keyboard.insertText(prompt);

  let submitted = false;
  if (site.submit) {
    const button = page.locator(site.submit).first();
    submitted = await button
      .waitFor({ state: "visible", timeout: 3_000 })
      .then(() => button.click({ timeout: 5_000 }))
      .then(() => true, () => false);
  }
  if (!submitted) await input.press("Enter");

  const stopGenerating = async () => {
    if (!site.generating) return;
    await page.locator(site.generating).first().click({ timeout: 2_000 }).catch(() => undefined);
  };

  try {
    // Wait for the tool to start an answer.
    const firstDeadline = Date.now() + (opts.firstResponseTimeoutMs ?? 60_000);
    while ((await answers.count()) <= before) {
      if (Date.now() > firstDeadline) {
        throw new ProviderError("browser", "timeout", `${site.label}: geen antwoord verschenen. Controleer het browservenster (captcha, limiet, melding).`);
      }
      await sleep(POLL_MS, signal);
    }

    const deadline = Date.now() + opts.answerTimeoutMs;
    let emitted = "";
    let latest = "";
    let lastChange = Date.now();
    while (true) {
      const text = ((await answers.last().innerText({ timeout: 5_000 }).catch(() => latest)) ?? "").trim();
      if (text !== latest) {
        latest = text;
        lastChange = Date.now();
        if (text.startsWith(emitted) && text.length > emitted.length) {
          yield { type: "text", text: text.slice(emitted.length) };
          emitted = text;
        }
      }
      const generating = site.generating ? (await page.locator(site.generating).count()) > 0 : false;
      if (!generating && latest && Date.now() - lastChange >= site.stableMs) break;
      if (Date.now() > deadline) {
        throw new ProviderError("browser", "timeout", `${site.label}: antwoord niet binnen ${Math.round(opts.answerTimeoutMs / 1000)} s afgerond.`);
      }
      await sleep(POLL_MS, signal);
    }

    const citations = site.citations ? await collectCitations(page, site) : [];
    yield {
      type: "done",
      result: {
        text: latest,
        modelReported: `${site.id}-web`,
        finishReason: "stop",
        rawFinishReason: "ui-stable",
        usage: { inputTokens: null, outputTokens: null },
        // The tool's own conversation URL: lets a reviewer open the original thread.
        providerRequestId: page.url(),
        citations,
      },
    };
  } catch (err) {
    if (err instanceof ProviderError && err.code === "cancelled") await stopGenerating();
    throw err;
  }
}

async function collectCitations(page: Page, site: SiteProfile): Promise<Citation[]> {
  const scope = site.citationsScope ? page.locator(site.citationsScope).last() : page.locator(site.response).last();
  const raw = await scope
    .locator(site.citations!)
    .evaluateAll((els) =>
      els.map((a) => ({ url: (a as HTMLAnchorElement).href, title: (a.textContent ?? "").trim() || a.getAttribute("aria-label") || undefined })),
    )
    .catch(() => [] as { url: string; title?: string }[]);
  const seen = new Set<string>();
  return raw.filter((c) => c.url.startsWith("http") && !seen.has(c.url) && seen.add(c.url)).slice(0, 50);
}
