import type { Page } from "playwright";

/**
 * Detects "verify you are human" pages (Cloudflare and similar). We never try to get past
 * these automatically: the user completes the check in the visible window, the workspace
 * only waits for that to happen.
 */
const TEXT = /verify you are human|verifieer dat u een mens bent|controleer of u een mens bent|bevestig dat je een mens bent|checking your browser|even geduld/i;
const TITLE = /just a moment|een ogenblik|even geduld|attention required/i;
const MARKERS = 'iframe[src*="challenges.cloudflare.com"], #challenge-form, #challenge-running, #cf-challenge-running, [id^="cf-chl"]';

export async function isHumanCheck(page: Page): Promise<boolean> {
  if (/challenges\.cloudflare\.com|\/cdn-cgi\/challenge-platform/.test(page.url())) return true;
  if (TITLE.test(await page.title().catch(() => ""))) return true;
  if ((await page.locator(MARKERS).count().catch(() => 0)) > 0) return true;
  const body = await page
    .locator("body")
    .innerText({ timeout: 2_000 })
    .catch(() => "");
  return TEXT.test(body.slice(0, 3_000));
}

/** Brings the window to the front and waits (up to `timeoutMs`) until the check is gone. */
export async function waitForHuman(page: Page, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  await page.bringToFront().catch(() => undefined);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) return false;
    await new Promise((r) => setTimeout(r, 1_000));
    if (!(await isHumanCheck(page))) return true;
  }
  return false;
}

export const HUMAN_CHECK_MESSAGE = (label: string) =>
  `${label} vraagt om een menselijke controle ("Verifieer dat u een mens bent"). Rond die af in het browservenster dat nu op de voorgrond staat en probeer het daarna opnieuw. Blijft de site dit vragen, gebruik deze tool dan voorlopig via Vergelijk/Diep onderzoek met andere tools, of later via zijn API.`;
