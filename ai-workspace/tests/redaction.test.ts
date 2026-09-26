import { describe, expect, it } from "vitest";
import { Redactor } from "@/server/security/redaction";

describe("Redactor", () => {
  it("masks e-mail, valid IBAN, valid BSN, phone and card numbers with stable placeholders", () => {
    const r = new Redactor();
    const out = r.redact(
      "Mail jan@example.com of jan@example.com. IBAN NL91 ABNA 0417 1643 00, BSN 111222333, bel +31 6 12345678, kaart 4111 1111 1111 1111.",
    );
    expect(out).toContain("[EMAIL_1] of [EMAIL_1]");
    expect(out).toContain("[IBAN_1]");
    expect(out).toContain("[BSN_1]");
    expect(out).toContain("[PHONE_1]");
    expect(out).toContain("[CARD_1]");
    expect(out).not.toMatch(/jan@|0417|111222333|12345678|4111/);
    expect(r.summary()).toEqual({ total: 6, byType: { EMAIL: 2, IBAN: 1, BSN: 1, PHONE: 1, CARD: 1 } });
  });

  it("keeps placeholders consistent across multiple texts in one request", () => {
    const r = new Redactor();
    expect(r.redact("a@b.nl")).toBe("[EMAIL_1]");
    expect(r.redact("c@d.nl en a@b.nl")).toBe("[EMAIL_2] en [EMAIL_1]");
  });

  it("does not mask numbers that fail checksums", () => {
    const r = new Redactor();
    const text = "Factuur 123456789, IBAN NL00 ABNA 0000 0000 00, bedrag 4111 1111 1111 1112";
    expect(r.redact(text)).toBe(text);
    expect(r.summary().total).toBe(0);
  });
});
