/**
 * "Use each engine for what it is best at." Pure logic, shared by the server (automatic
 * routing in chat) and the browser (default role assignment in workflows).
 *
 * Models carry capability tags (see server/ai/registry.ts); roles list the tags they need,
 * most important first. The best-scoring available model wins; ties keep registry order.
 */

export const CAPABILITY_TAGS = [
  "web-research",
  "sources",
  "fact-check",
  "critical-review",
  "structure",
  "writing",
  "reasoning",
  "long-context",
  "coding",
  "fast",
  "offline",
  "manual",
] as const;
export type CapabilityTag = (typeof CAPABILITY_TAGS)[number];

export type Role = "research" | "draft" | "review" | "factcheck" | "final" | "judge" | "general" | "longdoc";

export const ROLE_PREFERENCES: Record<Role, CapabilityTag[]> = {
  research: ["sources", "web-research"],
  draft: ["structure", "writing", "reasoning"],
  review: ["critical-review", "reasoning", "long-context"],
  factcheck: ["fact-check", "web-research", "sources"],
  final: ["writing", "structure", "reasoning"],
  judge: ["critical-review", "reasoning", "long-context"],
  general: ["reasoning", "writing"],
  longdoc: ["long-context", "reasoning"],
};

export interface RankableModel {
  id: string;
  tags: readonly string[];
  available: boolean;
}

export function scoreModel(model: RankableModel, role: Role): number {
  const prefs = ROLE_PREFERENCES[role];
  const score = prefs.reduce((sum, tag, i) => (model.tags.includes(tag) ? sum + (prefs.length - i) * 10 : sum), 0);
  // Equal strengths: an automatic route beats one where the user has to paste by hand.
  return score > 0 && model.tags.includes("manual") ? score - 5 : score;
}

/** Best available model for a role, avoiding `exclude` unless nothing else is available. */
export function bestFor(role: Role, models: RankableModel[], exclude: string[] = []): string | null {
  const available = models.filter((m) => m.available);
  const rank = (list: RankableModel[]) =>
    list
      .map((m, i) => ({ m, i, s: scoreModel(m, role) }))
      .sort((a, b) => b.s - a.s || a.i - b.i)[0]?.m.id ?? null;
  return rank(available.filter((m) => !exclude.includes(m.id))) ?? rank(available);
}

export interface ResearchAssignment {
  research: string;
  draft: string;
  review: string;
  factcheck: string | null;
  final: string;
}

/** Strength-based default team for the research pipeline. */
export function suggestResearchTeam(models: RankableModel[]): ResearchAssignment | null {
  const research = bestFor("research", models);
  if (!research) return null;
  const draft = bestFor("draft", models, [research])!;
  // Independent review: never the model that wrote the draft, if another one exists.
  let review = bestFor("review", models, [draft, research])!;
  if (review === draft) review = bestFor("review", models, [draft])!;
  const factcheck = bestFor("factcheck", models, [draft, review]);
  // A fact check only adds value when done by an engine that did not write or review the text.
  return { research, draft, review, factcheck: factcheck && factcheck !== draft && factcheck !== review ? factcheck : null, final: draft };
}

/** Strength-based default selection for comparing: up to 4 distinct engines + a judge. */
export function suggestCompareTeam(models: RankableModel[]): { modelIds: string[]; judge: string | null } {
  const available = models.filter((m) => m.available);
  // Comparing is automatic by nature: leave out test engines and steps you would have to paste by hand.
  const preferred = available.filter((m) => !["offline", "fast", "manual"].some((t) => m.tags.includes(t)));
  const pool = (preferred.length >= 2 ? preferred : available).slice(0, 4).map((m) => m.id);
  return { modelIds: pool, judge: bestFor("judge", models) };
}

const PATTERNS: [Role, RegExp, string][] = [
  [
    "factcheck",
    /\b(klopt\s+(het|dit|dat)|controleer\s+(of|de\s+feiten)|verifieer|feitencheck|fact[- ]?check|is\s+het\s+waar)\b/i,
    "Vraag om feiten te controleren",
  ],
  [
    "research",
    /\b(bronnen?|sources?|actueel|actuele|recent|recente|nieuws|news|laatste|latest|vandaag|today|dit\s+jaar|20[2-3]\d|zoek|search|website|link)\b/i,
    "Vraag om actuele informatie of bronnen",
  ],
  [
    "review",
    /\b(beoordeel|review|analyseer|analyse|risico'?s?|risk|kritisch|zwakke\s+punten|toets|audit|evalueer)\b/i,
    "Vraag om kritische analyse",
  ],
  [
    "draft",
    /\b(schrijf|write|stel\s+.{0,40}\s+op|opstellen|e-?mail|brief|memo|rapport|report|samenvat\w*|summari[sz]e|herschrijf|rewrite|vertaal|translate|plan)\b/i,
    "Schrijf- of uitwerkopdracht",
  ],
];

/** Rule-based task classification for automatic routing. Transparent: returns the reason. */
export function classifyTask(question: string, contextChars = 0): { role: Role; reason: string } {
  for (const [role, re, reason] of PATTERNS) if (re.test(question)) return { role, reason };
  if (contextChars > 60_000) return { role: "longdoc", reason: "Veel projectdocumenten in de context" };
  return { role: "general", reason: "Algemene vraag" };
}
