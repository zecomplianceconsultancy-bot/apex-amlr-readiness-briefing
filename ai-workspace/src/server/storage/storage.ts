import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/server/config/env";
import { decrypt, encrypt } from "@/server/security/crypto";
import { encryptionKey } from "@/server/security/keys";

/**
 * Blob storage abstraction. The MVP driver writes AES-256-GCM encrypted blobs to local disk;
 * an S3/Azure Blob driver (with SSE-KMS and bucket-per-tenant if needed) implements the same
 * interface later.
 */
export interface BlobStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

const SAFE_KEY = /^[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+$/;

class LocalEncryptedStorage implements BlobStorage {
  private resolve(key: string): string {
    // Keys are generated server-side, but never let one escape the storage root.
    if (!SAFE_KEY.test(key)) throw new Error("Invalid storage key");
    return path.join(path.resolve(env().STORAGE_DIR), `${key}.bin`);
  }

  private key(): Buffer {
    return encryptionKey();
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, encrypt(data, this.key(), key), { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    return decrypt(await readFile(this.resolve(key)), this.key(), key);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

let instance: BlobStorage | undefined;
export function storage(): BlobStorage {
  instance ??= new LocalEncryptedStorage();
  return instance;
}
