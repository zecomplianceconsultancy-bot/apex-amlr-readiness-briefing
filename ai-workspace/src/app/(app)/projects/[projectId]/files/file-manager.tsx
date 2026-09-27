"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, Card, ErrorText } from "@/components/ui";
import { api, toApiError } from "@/lib/api-client";
import { formatBytes, formatDateTime } from "@/lib/format";

interface FileRow {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  includeInContext: boolean;
  extractedChars: number;
  extractionError: string | null;
  createdAt: string;
}

export function FileManager({ projectId, canEdit, maxMb, files }: { projectId: string; canEdit: boolean; maxMb: number; files: FileRow[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/api/v1/projects/${projectId}/files`;

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Actie mislukt.");
    } finally {
      setBusy(false);
    }
  }

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    await run(async () => {
      for (const file of Array.from(list)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(base, { method: "POST", body: form });
        if (!res.ok) throw await toApiError(res);
      }
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-slate-600">
              Toegestaan: .txt, .md, .csv, .json, .pdf en afbeeldingen (.png, .jpg, .webp) — max {maxMb} MB per bestand.
            </p>
            <Button onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? "Bezig…" : "Bestand uploaden"}
            </Button>
            <input ref={inputRef} type="file" multiple hidden accept=".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => void upload(e.target.files)} />
          </div>
        </Card>
      )}
      <ErrorText>{error}</ErrorText>
      <Card className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Bestand</th>
              <th className="px-4 py-2">Grootte</th>
              <th className="px-4 py-2">Tekst</th>
              <th className="px-4 py-2">In context</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {files.map((f) => (
              <tr key={f.id}>
                <td className="px-4 py-2">
                  <a href={`${base}/${f.id}`} className="font-medium text-indigo-700 hover:underline">
                    {f.filename}
                  </a>
                  <div className="text-xs text-slate-400" title={f.sha256}>
                    {formatDateTime(f.createdAt)} · sha256 {f.sha256.slice(0, 10)}…
                  </div>
                </td>
                <td className="px-4 py-2 text-slate-600">{formatBytes(f.sizeBytes)}</td>
                <td className="px-4 py-2 text-slate-600">
                  {f.mimeType.startsWith("image/") ? (
                    "afbeelding"
                  ) : f.extractionError ? (
                    <span className="text-rose-600" title={f.extractionError}>
                      extractie mislukt
                    </span>
                  ) : (
                    `${f.extractedChars.toLocaleString("nl-NL")} tekens`
                  )}
                </td>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={f.includeInContext}
                    disabled={!canEdit || busy || f.extractedChars === 0}
                    onChange={(e) => void run(() => api(`${base}/${f.id}`, { method: "PATCH", json: { includeInContext: e.target.checked } }))}
                  />
                </td>
                <td className="px-4 py-2 text-right">
                  {canEdit && (
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`"${f.filename}" verwijderen? Het versleutelde bestand wordt definitief gewist.`)) void run(() => api(`${base}/${f.id}`, { method: "DELETE" }));
                      }}
                    >
                      Verwijderen
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {files.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Nog geen bestanden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
