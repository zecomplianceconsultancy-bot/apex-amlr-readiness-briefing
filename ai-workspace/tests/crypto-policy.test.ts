import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeAuditHash, GENESIS_HASH, verifyChain } from "@/server/audit/chain";
import { canonicalJson, decrypt, encrypt } from "@/server/security/crypto";
import { evaluateEgress } from "@/server/security/data-policy";
import { normalizeTurns } from "@/server/ai/types";

describe("encryption at rest", () => {
  const key = randomBytes(32);
  it("round-trips and binds ciphertext to its storage key", () => {
    const blob = encrypt(Buffer.from("geheim"), key, "p/1");
    expect(decrypt(blob, key, "p/1").toString()).toBe("geheim");
    expect(() => decrypt(blob, key, "p/2")).toThrow();
    expect(() => decrypt(blob, randomBytes(32), "p/1")).toThrow();
  });
  it("detects tampering", () => {
    const blob = encrypt(Buffer.from("geheim"), key, "k/1");
    blob[blob.length - 1]! ^= 1;
    expect(() => decrypt(blob, key, "k/1")).toThrow();
  });
});

describe("data egress policy", () => {
  it("allows equal or lower classification, blocks higher", () => {
    expect(evaluateEgress("internal", "confidential").allowed).toBe(true);
    expect(evaluateEgress("confidential", "confidential").allowed).toBe(true);
    expect(evaluateEgress("restricted", "confidential").allowed).toBe(false);
  });
});

describe("canonicalJson", () => {
  it("is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(canonicalJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }));
  });
});

describe("audit hash chain", () => {
  const entry = (action: string) => ({
    occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    actorUserId: null,
    actorType: "system",
    action,
    projectId: null,
    entityType: null,
    entityId: null,
    ip: null,
    userAgent: null,
    details: { n: 1 },
  });
  const build = () => {
    const a = entry("a");
    const ha = computeAuditHash(GENESIS_HASH, a);
    const b = entry("b");
    const hb = computeAuditHash(ha, b);
    return [
      { ...a, seq: 1, prevHash: GENESIS_HASH, hash: ha },
      { ...b, seq: 2, prevHash: ha, hash: hb },
    ];
  };
  it("verifies an intact chain", () => expect(verifyChain(build()).ok).toBe(true));
  it("detects modified content", () => {
    const rows = build();
    rows[0]!.details = { n: 2 };
    expect(verifyChain(rows)).toMatchObject({ ok: false, brokenAtSeq: 1 });
  });
  it("detects a deleted entry", () => {
    expect(verifyChain([build()[1]!])).toMatchObject({ ok: false, brokenAtSeq: 2 });
  });
});

describe("normalizeTurns", () => {
  it("merges consecutive roles and drops leading assistant turns", () => {
    expect(
      normalizeTurns([
        { role: "assistant", content: "x" },
        { role: "user", content: "a" },
        { role: "user", content: "b" },
        { role: "assistant", content: "c" },
      ]),
    ).toEqual([
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c" },
    ]);
  });
});
