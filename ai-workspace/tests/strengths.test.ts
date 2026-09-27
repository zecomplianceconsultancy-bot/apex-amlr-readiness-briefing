import { describe, expect, it } from "vitest";
import { bestFor, classifyTask, suggestCompareTeam, suggestResearchTeam } from "@/lib/strengths";

const tools = [
  { id: "browser:perplexity", tags: ["sources", "web-research"], available: true },
  { id: "browser:chatgpt", tags: ["structure", "writing", "reasoning", "data-analysis", "images"], available: true },
  { id: "browser:claude", tags: ["critical-review", "reasoning", "long-context", "writing"], available: true },
  { id: "browser:gemini", tags: ["fact-check", "images", "images-pro", "web-research", "long-context", "reasoning"], available: true },
  { id: "mock:echo", tags: ["offline", "fast"], available: true },
];

describe("strength-based assignment", () => {
  it("builds the research team from each tool's strengths", () => {
    expect(suggestResearchTeam(tools)).toEqual({
      research: "browser:perplexity",
      draft: "browser:chatgpt",
      review: "browser:claude",
      factcheck: "browser:gemini",
      final: "browser:chatgpt",
    });
  });

  it("presets drop optional steps for fewer copy/paste rounds", async () => {
    const { applyPreset } = await import("@/lib/strengths");
    const team = suggestResearchTeam(tools)!;
    expect(applyPreset(team, "quick")).toEqual({ ...team, factcheck: null, final: null });
    expect(applyPreset(team, "minimal")).toEqual({ research: team.research, draft: team.draft, review: null, factcheck: null, final: null });
    expect(applyPreset(team, "full")).toEqual(team);
  });

  it("keeps the review independent from the draft and degrades gracefully", () => {
    const two = tools.filter((t) => t.id === "browser:perplexity" || t.id === "browser:chatgpt");
    const team = suggestResearchTeam(two)!;
    expect(team.draft).not.toBe(team.review);
    expect(team.factcheck).toBeNull();
    const unavailable = tools.map((t) => (t.id === "browser:claude" ? { ...t, available: false } : t));
    expect(suggestResearchTeam(unavailable)!.review).not.toBe("browser:claude");
  });

  it("compares the four real tools and lets the strongest critic judge", () => {
    expect(suggestCompareTeam(tools)).toEqual({
      modelIds: ["browser:perplexity", "browser:chatgpt", "browser:claude", "browser:gemini"],
      judge: "browser:claude",
    });
  });

  it("routes chat questions by task type", () => {
    const pick = (q: string, chars = 0) => bestFor(classifyTask(q, chars).role, tools);
    expect(pick("Wat is het laatste nieuws over AMLR? Geef bronnen")).toBe("browser:perplexity");
    expect(pick("Klopt het dat de UBO-drempel 25% is?")).toBe("browser:gemini");
    expect(pick("Beoordeel de risico's van dit beleid")).toBe("browser:claude");
    expect(pick("Schrijf een e-mail aan de klant")).toBe("browser:chatgpt");
    expect(pick("Hoi", 100_000)).toBe("browser:claude");
    expect(pick("Maak een infographic over de AMLR-tijdlijn")).toBe("browser:gemini");
    expect(pick("Analyseer deze Excel met transacties en maak een grafiek")).toBe("browser:chatgpt");
    expect(classifyTask("Hoi")).toEqual({ role: "general", reason: "Algemene vraag" });
  });
});
