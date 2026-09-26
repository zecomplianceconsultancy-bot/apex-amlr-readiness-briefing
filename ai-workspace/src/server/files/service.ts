import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { recordAudit, type RequestMeta } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import { env } from "@/server/config/env";
import { db, schema } from "@/server/db/client";
import { badRequest, notFound } from "@/server/http/errors";
import { sha256Hex } from "@/server/security/crypto";
import { storage } from "@/server/storage/storage";
import { ALLOWED_TYPES, detectType, extractFileText } from "./extract";

const { files } = schema;

export const fileColumns = {
  id: files.id,
  filename: files.filename,
  mimeType: files.mimeType,
  sizeBytes: files.sizeBytes,
  sha256: files.sha256,
  includeInContext: files.includeInContext,
  extractedChars: files.extractedText,
  extractionError: files.extractionError,
  createdAt: files.createdAt,
};

export async function listFiles(projectId: string) {
  const rows = await db()
    .select(fileColumns)
    .from(files)
    .where(and(eq(files.projectId, projectId), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt));
  // Never send extracted text to the list view; only its size.
  return rows.map(({ extractedChars, ...r }) => ({ ...r, extractedChars: extractedChars?.length ?? 0 }));
}

export async function uploadFile(user: SessionUser, projectId: string, file: File, meta: RequestMeta) {
  const maxBytes = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size === 0) throw badRequest("Leeg bestand.");
  if (file.size > maxBytes) throw badRequest(`Bestand is groter dan ${env().MAX_UPLOAD_MB} MB.`);
  const filename = file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 255);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = detectType(filename, bytes);
  if (!mimeType) throw badRequest(`Bestandstype niet toegestaan. Toegestaan: ${Object.keys(ALLOWED_TYPES).join(", ")}`);

  let extractedText: string | null = null;
  let extractionError: string | null = null;
  try {
    extractedText = await extractFileText(mimeType, bytes);
  } catch (err) {
    extractionError = err instanceof Error ? err.message.slice(0, 500) : "Extractie mislukt";
  }

  const sha256 = sha256Hex(bytes);
  const storageKey = `${projectId}/${randomUUID()}`;
  await storage().put(storageKey, bytes);

  try {
    return await db().transaction(async (tx) => {
      const [row] = await tx
        .insert(files)
        .values({
          projectId,
          uploadedBy: user.id,
          filename,
          mimeType,
          sizeBytes: bytes.length,
          sha256,
          storageKey,
          extractedText,
          extractionError,
          includeInContext: extractedText !== null && extractedText.length > 0,
        })
        .returning({ id: files.id });
      await recordAudit(
        {
          action: "file.upload",
          actorUserId: user.id,
          projectId,
          entityType: "file",
          entityId: row!.id,
          details: { filename, mimeType, sizeBytes: bytes.length, sha256, extracted: extractedText !== null },
          request: meta,
        },
        tx,
      );
      return row!;
    });
  } catch (err) {
    await storage().delete(storageKey); // no orphaned blobs
    throw err;
  }
}

async function getFile(projectId: string, fileId: string) {
  const [row] = await db()
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.projectId, projectId), isNull(files.deletedAt)))
    .limit(1);
  if (!row) throw notFound("Bestand");
  return row;
}

export async function setIncludeInContext(user: SessionUser, projectId: string, fileId: string, include: boolean, meta: RequestMeta) {
  const f = await getFile(projectId, fileId);
  if (include && !f.extractedText) throw badRequest("Dit bestand heeft geen geëxtraheerde tekst.");
  await db().transaction(async (tx) => {
    await tx.update(files).set({ includeInContext: include }).where(eq(files.id, fileId));
    await recordAudit(
      { action: "file.update", actorUserId: user.id, projectId, entityType: "file", entityId: fileId, details: { includeInContext: include }, request: meta },
      tx,
    );
  });
}

/**
 * Soft-deletes the record (invocations keep referencing its id + sha256 for provenance)
 * and physically removes the encrypted blob and extracted text.
 */
export async function deleteFile(user: SessionUser, projectId: string, fileId: string, meta: RequestMeta) {
  const f = await getFile(projectId, fileId);
  await db().transaction(async (tx) => {
    await tx
      .update(files)
      .set({ deletedAt: new Date(), extractedText: null, includeInContext: false })
      .where(eq(files.id, fileId));
    await recordAudit(
      { action: "file.delete", actorUserId: user.id, projectId, entityType: "file", entityId: fileId, details: { filename: f.filename, sha256: f.sha256 }, request: meta },
      tx,
    );
  });
  await storage().delete(f.storageKey);
}

export async function downloadFile(user: SessionUser, projectId: string, fileId: string, meta: RequestMeta) {
  const f = await getFile(projectId, fileId);
  const data = await storage().get(f.storageKey);
  if (sha256Hex(data) !== f.sha256) throw new Error(`Integrity check failed for file ${fileId}`);
  await recordAudit({ action: "file.download", actorUserId: user.id, projectId, entityType: "file", entityId: fileId, details: { filename: f.filename }, request: meta });
  return { data, filename: f.filename, mimeType: f.mimeType };
}
