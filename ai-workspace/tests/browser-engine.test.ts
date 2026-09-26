import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runOnPage } from "@/server/ai/browser/engine";
import { closeBrowser } from "@/server/ai/browser/session";
import { registerSite, type SiteProfile } from "@/server/ai/browser/sites";
import { BrowserProvider, flattenPrompt } from "@/server/ai/providers/browser";
import { ProviderError, type ProviderEvent } from "@/server/ai/types";
import { fixtureSelectors, startFixtureSite } from "./fixtures/chat-site";

const nonSpace = (s: string) => s.replace(/\s+/g, "").length;

let site: Awaited<ReturnType<typeof startFixtureSite>>;
let browser: Browser;
let page: Page;

const profile = (path = "/", id = "fixture"): SiteProfile => ({ id, label: "Fixture", newChatUrl: `${site.baseUrl}${path}`, ...fixtureSelectors });

async function collect(gen: AsyncGenerator<ProviderEvent>) {
  const deltas: string[] = [];
  for await (const e of gen) {
    if (e.type === "text") deltas.push(e.text);
    else return { deltas, result: e.result };
  }
  throw new Error("no done event");
}

beforeAll(async () => {
  site = await startFixtureSite();
  browser = await chromium.launch();
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
  await closeBrowser();
  await site?.close();
});

describe("browser engine", () => {
  it("types the prompt, streams the answer and collects deduplicated sources", { timeout: 20_000 }, async () => {
    const { deltas, result } = await collect(runOnPage(page, profile(), "Wat is de UBO-drempel?", { answerTimeoutMs: 20_000 }));
    expect(deltas.length).toBeGreaterThan(3); // really streamed, not one blob
    expect(result.text).toContain("Antwoord op: Wat is de UBO-drempel?");
    expect(result.text).toContain(`Ik ontving ${nonSpace("Wat is de UBO-drempel?")} tekens`);
    expect(result.citations).toEqual([
      { url: "https://example.org/bron-1", title: "Bron 1" },
      { url: "https://example.org/bron-2", title: "Bron 2" },
    ]);
    expect(result.modelReported).toBe("fixture-web");
    expect(result.providerRequestId).toMatch(/\/thread\/\d+$/); // link to the tool's own thread
  });

  it("handles contenteditable inputs and multi-line prompts", { timeout: 20_000 }, async () => {
    const prompt = "<instructions>\nWees kort.\n</instructions>\n\nNoem drie AML-risico's";
    const { result } = await collect(runOnPage(page, profile("/ce"), prompt, { answerTimeoutMs: 20_000 }));
    expect(result.text).toContain("Antwoord op: Noem drie AML-risico's");
    expect(result.text).toContain(`Ik ontving ${nonSpace(prompt)} tekens`);
  });

  it("reports a login problem when the input is missing", async () => {
    await expect(collect(runOnPage(page, profile("/login"), "hoi", { answerTimeoutMs: 5_000, inputTimeoutMs: 1_000 }))).rejects.toMatchObject({
      code: "auth",
    });
  });

  it("clicks the tool's stop button when cancelled", { timeout: 20_000 }, async () => {
    const ac = new AbortController();
    const run = async () => {
      for await (const e of runOnPage(page, profile(), "lang antwoord", { answerTimeoutMs: 20_000, signal: ac.signal })) {
        if (e.type === "text") ac.abort();
      }
    };
    await expect(run()).rejects.toMatchObject({ code: "cancelled" });
    expect(await page.evaluate(() => (window as unknown as { stopped: boolean }).stopped)).toBe(true);
  });
});

describe("BrowserProvider", () => {
  it("flattens instructions and history into one prompt with the question last", () => {
    expect(
      flattenPrompt("Sys", [
        { role: "user", content: "v1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "v2" },
      ]),
    ).toBe("<instructions>\nSys\n</instructions>\n\n<previous_conversation>\nUser: v1\n\nAssistant: a1\n</previous_conversation>\n\nv2");
  });

  it("runs through the shared persistent browser and queues concurrent requests per tool", async () => {
    registerSite(profile("/", "fixture-provider"));
    const provider = new BrowserProvider();
    expect(provider.isConfigured()).toBe(true);
    const ask = (q: string) => collect(provider.streamChat({ providerModel: "fixture-provider", messages: [{ role: "user", content: q }], maxOutputTokens: 1000 }));
    const [a, b] = await Promise.all([ask("eerste vraag"), ask("tweede vraag")]);
    expect(a.result.text).toContain("Antwoord op: eerste vraag");
    expect(b.result.text).toContain("Antwoord op: tweede vraag");
  }, 30_000);

  it("refuses prompts longer than the tool accepts", async () => {
    registerSite({ ...profile("/", "fixture-small"), maxPromptChars: 10 });
    const gen = new BrowserProvider().streamChat({ providerModel: "fixture-small", messages: [{ role: "user", content: "x".repeat(50) }], maxOutputTokens: 10 });
    await expect(gen.next()).rejects.toBeInstanceOf(ProviderError);
  });
});
