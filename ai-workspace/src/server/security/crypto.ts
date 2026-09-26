import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** URL-safe random token with 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Deterministic JSON serialization (object keys sorted recursively). Used wherever a hash
 * must be reproducible: audit chain entries and model request fingerprints.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Envelope for data at rest: AES-256-GCM
//   MAGIC(4) | IV(12) | AUTH_TAG(16) | CIPHERTEXT
// The associated data binds a ciphertext to its storage key so blobs cannot be swapped.
// A key-id byte can be added to MAGIC for key rotation / KMS envelope keys later.
// ---------------------------------------------------------------------------

const MAGIC = Buffer.from("AWE1");
const IV_LEN = 12;
const TAG_LEN = 16;

export function encrypt(plaintext: Uint8Array, key: Buffer, associatedData: string): Buffer {
  assertKey(key);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decrypt(envelope: Buffer, key: Buffer, associatedData: string): Buffer {
  assertKey(key);
  if (envelope.length < MAGIC.length + IV_LEN + TAG_LEN || !envelope.subarray(0, 4).equals(MAGIC)) {
    throw new Error("Invalid encrypted envelope");
  }
  const iv = envelope.subarray(4, 4 + IV_LEN);
  const tag = envelope.subarray(4 + IV_LEN, 4 + IV_LEN + TAG_LEN);
  const ciphertext = envelope.subarray(4 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function assertKey(key: Buffer): void {
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes");
}
