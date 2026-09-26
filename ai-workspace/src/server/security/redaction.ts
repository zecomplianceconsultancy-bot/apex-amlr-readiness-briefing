/**
 * Pre-egress PII masking. Runs on everything sent to an external model when the project has
 * `piiRedaction` enabled. Detected values are replaced by stable placeholders ([EMAIL_1],
 * [IBAN_2], ...) that are consistent across one request, so the model can still reason about
 * "the same IBAN" without seeing it.
 *
 * This is a deterministic, conservative baseline (checksums where they exist) — not a
 * replacement for a proper DLP/NER service, which can be plugged in behind the same interface.
 * Original values are never logged; only counts per type are recorded in the audit trail.
 */

export type PiiType = "EMAIL" | "IBAN" | "CARD" | "BSN" | "PHONE";

interface Detector {
  type: PiiType;
  pattern: RegExp;
  validate?: (match: string) => boolean;
}

const digitsOnly = (s: string) => s.replace(/\D/g, "");

function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, "").toUpperCase();
  if (iban.length < 15 || iban.length > 34) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of code) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

function luhnValid(raw: string): boolean {
  const digits = digitsOnly(raw);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Dutch citizen service number: 9 digits passing the "elfproef". */
function bsnValid(raw: string): boolean {
  const d = digitsOnly(raw);
  if (d.length !== 9 || /^0+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(d[i]) * (9 - i);
  sum -= Number(d[8]);
  return sum % 11 === 0;
}

// Order matters: more specific detectors run first so their matches are not re-matched.
const DETECTORS: Detector[] = [
  { type: "EMAIL", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: "IBAN", pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, validate: ibanValid },
  { type: "CARD", pattern: /\b\d(?:[ -]?\d){12,18}\b/g, validate: luhnValid },
  { type: "BSN", pattern: /\b\d{9}\b|\b\d{4}\.\d{2}\.\d{3}\b/g, validate: bsnValid },
  {
    type: "PHONE",
    pattern: /(?:(?:\+|00)[1-9]\d{0,2}[\s-]?(?:\(0\)[\s-]?)?\d(?:[\s-]?\d){6,11}|\b0[1-9](?:[\s-]?\d){8})\b/g,
  },
];

export class Redactor {
  private readonly placeholders = new Map<string, string>();
  private readonly counters: Record<PiiType, number> = { EMAIL: 0, IBAN: 0, CARD: 0, BSN: 0, PHONE: 0 };
  private readonly hits: Record<PiiType, number> = { EMAIL: 0, IBAN: 0, CARD: 0, BSN: 0, PHONE: 0 };

  redact(text: string): string {
    let out = text;
    for (const detector of DETECTORS) {
      out = out.replace(detector.pattern, (match) => {
        if (detector.validate && !detector.validate(match)) return match;
        this.hits[detector.type]++;
        const key = `${detector.type}:${match.replace(/[\s.-]/g, "").toLowerCase()}`;
        let placeholder = this.placeholders.get(key);
        if (!placeholder) {
          placeholder = `[${detector.type}_${++this.counters[detector.type]}]`;
          this.placeholders.set(key, placeholder);
        }
        return placeholder;
      });
    }
    return out;
  }

  /** Counts per type (occurrences, not unique values). Safe to log. */
  summary(): { total: number; byType: Partial<Record<PiiType, number>> } {
    const byType: Partial<Record<PiiType, number>> = {};
    let total = 0;
    for (const [type, n] of Object.entries(this.hits) as [PiiType, number][]) {
      if (n > 0) {
        byType[type] = n;
        total += n;
      }
    }
    return { total, byType };
  }
}
