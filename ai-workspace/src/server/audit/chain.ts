import { canonicalJson, sha256Hex } from "@/server/security/crypto";

export const GENESIS_HASH = "0".repeat(64);

/** The fields covered by the hash. Changing this list invalidates existing chains. */
export interface ChainedFields {
  occurredAt: Date;
  actorUserId: string | null;
  actorType: string;
  action: string;
  projectId: string | null;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  userAgent: string | null;
  details: unknown;
}

export function computeAuditHash(prevHash: string, entry: ChainedFields): string {
  return sha256Hex(
    prevHash +
      canonicalJson({
        occurredAt: entry.occurredAt.toISOString(),
        actorUserId: entry.actorUserId,
        actorType: entry.actorType,
        action: entry.action,
        projectId: entry.projectId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        ip: entry.ip,
        userAgent: entry.userAgent,
        details: entry.details,
      }),
  );
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  /** First sequence number whose hash or link does not match. */
  brokenAtSeq?: number;
  reason?: string;
}

export function verifyChain(rows: (ChainedFields & { seq: number; prevHash: string; hash: string })[]): VerifyResult {
  let expectedPrev = GENESIS_HASH;
  for (const row of rows) {
    if (row.prevHash !== expectedPrev) {
      return { ok: false, checked: rows.indexOf(row), brokenAtSeq: row.seq, reason: "prev_hash does not link to previous entry" };
    }
    if (computeAuditHash(row.prevHash, row) !== row.hash) {
      return { ok: false, checked: rows.indexOf(row), brokenAtSeq: row.seq, reason: "entry content does not match its hash" };
    }
    expectedPrev = row.hash;
  }
  return { ok: true, checked: rows.length };
}
