import { extractText, getDocumentProxy } from "unpdf";

export const ALLOWED_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".pdf": "application/pdf",
};

export function detectType(filename: string, bytes: Uint8Array): string | null {
  const ext = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  const mime = ALLOWED_TYPES[ext];
  if (!mime) return null;
  // Do not trust the extension alone for binary formats.
  if (mime === "application/pdf" && Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") return null;
  return mime;
}

export async function extractFileText(mime: string, bytes: Uint8Array): Promise<string> {
  if (mime === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text.trim();
  }
  // Text formats must be valid UTF-8.
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
