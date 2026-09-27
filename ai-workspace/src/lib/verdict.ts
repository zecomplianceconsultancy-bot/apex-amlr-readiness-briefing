/** Verdict lines that reviewer-style answers end with. Pure: used on server and in the browser. */
export const REVIEW_VERDICTS = ["AKKOORD", "AANPASSEN", "ONBETROUWBAAR"] as const;
export const FACT_VERDICTS = ["CORRECT", "FOUTEN", "ONZEKER"] as const;
export const AGREEMENT_LEVELS = ["HOOG", "MIDDEL", "LAAG"] as const;

export type VerdictKey = "OORDEEL" | "OVEREENSTEMMING" | "FEITEN";

/** Reads the verdict line ("OORDEEL: …" etc.); tolerant of markdown and case; last valid one wins. */
export function parseVerdict(text: string, key: VerdictKey): string | null {
  const allowed: readonly string[] = key === "OORDEEL" ? REVIEW_VERDICTS : key === "FEITEN" ? FACT_VERDICTS : AGREEMENT_LEVELS;
  const re = new RegExp(`${key}\\s*\\**\\s*:\\s*\\**\\s*([A-Za-z]+)`, "gi");
  let found: string | null = null;
  for (const m of text.matchAll(re)) {
    const v = m[1]!.toUpperCase();
    if (allowed.includes(v)) found = v;
  }
  return found;
}
