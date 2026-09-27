import { extractText, getDocumentProxy } from "unpdf";

export const ALLOWED_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".pdf": "application/pdf",
  // Images (e.g. made in Gemini/ChatGPT) are stored for the project; they have no text.
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const hex = (bytes: Uint8Array, n: number) => Buffer.from(bytes.subarray(0, n)).toString("hex");
const MAGIC: Record<string, (b: Uint8Array) => boolean> = {
  "application/pdf": (b) => Buffer.from(b.subarray(0, 5)).toString("latin1") === "%PDF-",
  "image/png": (b) => hex(b, 8) === "89504e470d0a1a0a",
  "image/jpeg": (b) => hex(b, 3) === "ffd8ff",
  "image/webp": (b) => Buffer.from(b.subarray(0, 4)).toString("latin1") === "RIFF" && Buffer.from(b.subarray(8, 12)).toString("latin1") === "WEBP",
};

export function detectType(filename: string, bytes: Uint8Array): string | null {
  const ext = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const mime = ALLOWED_TYPES[ext];
  if (!mime) return null;
  // Do not trust the extension alone for binary formats.
  const check = MAGIC[mime];
  if (check && !check(bytes)) return null;
  return mime;
}

/** Returns null for formats without text (images). */
export async function extractFileText(mime: string, bytes: Uint8Array): Promise<string | null> {
  if (mime.startsWith("image/")) return null;
  if (mime === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text.trim();
  }
  // Text formats must be valid UTF-8.
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
