import { ProviderError, type AIProvider, type ChatRequest, type ProviderEvent } from "../types";

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new ProviderError("mock", "cancelled", "Request cancelled"));
    });
  });

/**
 * Offline provider for development, demos and tests. Streams back a description of exactly
 * what it received — handy to verify context assembly and PII masking without an API key.
 */
export class MockProvider implements AIProvider {
  readonly id = "mock";
  readonly displayName = "Mock (offline)";

  constructor(
    private readonly enabled: () => boolean,
    private readonly delayMs = 15,
  ) {}

  isConfigured(): boolean {
    return this.enabled();
  }

  async *streamChat(req: ChatRequest): AsyncGenerator<ProviderEvent> {
    const last = [...req.messages].reverse().find((m) => m.role === "user");
    const docCount = (req.system?.match(/<document /g) ?? []).length;
    const text = [
      `**Mock-antwoord** (model \`${req.providerModel}\`).`,
      "",
      `Ik ontving ${req.messages.length} bericht(en), een systeemprompt van ${req.system?.length ?? 0} tekens en ${docCount} projectdocument(en).`,
      "",
      "Jouw laatste bericht, zoals het bij de provider aankwam (na eventuele PII-masking):",
      "",
      `> ${(last?.content ?? "").split("\n").join("\n> ")}`,
    ].join("\n");

    let out = "";
    for (const token of text.match(/\S+\s*|\s+/g) ?? []) {
      if (req.signal?.aborted) throw new ProviderError("mock", "cancelled", "Request cancelled");
      await sleep(this.delayMs, req.signal);
      out += token;
      yield { type: "text", text: token };
    }
    yield {
      type: "done",
      result: {
        text: out,
        modelReported: "mock-echo-1",
        finishReason: "stop",
        rawFinishReason: "end_turn",
        usage: { inputTokens: Math.ceil(((req.system?.length ?? 0) + req.messages.reduce((n, m) => n + m.content.length, 0)) / 4), outputTokens: Math.ceil(out.length / 4) },
        providerRequestId: `mock_${Date.now()}`,
        citations: [],
      },
    };
  }
}
