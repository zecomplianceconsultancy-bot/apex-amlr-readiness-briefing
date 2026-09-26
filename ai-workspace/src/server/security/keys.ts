import "server-only";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env } from "@/server/config/env";

let cached: Buffer | undefined;

/**
 * Data-at-rest key. Taken from ENCRYPTION_KEY when set; otherwise generated once and stored
 * in DATA_DIR/encryption.key (owner-only permissions). Back up the DATA_DIR as a whole:
 * without this key, stored files cannot be decrypted.
 */
export function encryptionKey(): Buffer {
  if (cached) return cached;
  const fromEnv = env().ENCRYPTION_KEY;
  if (fromEnv) return (cached = Buffer.from(fromEnv, "base64"));
  const file = path.join(env().DATA_DIR, "encryption.key");
  if (!existsSync(file)) {
    mkdirSync(env().DATA_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });
  }
  const key = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
  if (key.length !== 32) throw new Error(`${file} does not contain a valid 32-byte key`);
  return (cached = key);
}
