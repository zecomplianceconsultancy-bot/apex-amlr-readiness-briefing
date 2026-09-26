"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, ErrorText, Textarea } from "@/components/ui";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

interface Version {
  id: string;
  version: number;
  content: string;
  createdAt: string;
  createdBy: string;
}

export function ContextEditor({ projectId, canEdit, versions }: { projectId: string; canEdit: boolean; versions: Version[] }) {
  const router = useRouter();
  const latest = versions[0];
  const [content, setContent] = useState(latest?.content ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Version | null>(null);
  const dirty = content !== (latest?.content ?? "");

  async function save() {
    setPending(true);
    setError(null);
    try {
      await api(`/api/v1/projects/${projectId}/context`, { method: "PUT", json: { content } });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_240px]">
      <Card>
        <div className="mb-2 text-xs text-slate-500">{latest ? `Huidige versie: v${latest.version}` : "Nog geen context opgeslagen"}</div>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={18}
          disabled={!canEdit}
          className="font-mono text-[13px]"
          placeholder="Bijv. doel van het project, doelgroep, terminologie, gewenste toon, bronnen die leidend zijn…"
        />
        <div className="mt-3 flex items-center gap-3">
          {canEdit && (
            <Button onClick={save} disabled={!dirty || pending}>
              {pending ? "Opslaan…" : "Opslaan als nieuwe versie"}
            </Button>
          )}
          {dirty && <span className="text-xs text-amber-700">Niet-opgeslagen wijzigingen</span>}
        </div>
        <div className="mt-3">
          <ErrorText>{error}</ErrorText>
        </div>
      </Card>
      <Card className="h-fit">
        <h2 className="mb-2 text-sm font-medium">Versiegeschiedenis</h2>
        <ul className="space-y-1 text-sm">
          {versions.map((v) => (
            <li key={v.id}>
              <button onClick={() => setViewing(v)} className="w-full rounded px-2 py-1 text-left hover:bg-slate-100">
                <span className="font-medium">v{v.version}</span> <span className="text-xs text-slate-500">{formatDateTime(v.createdAt)}</span>
                <div className="text-xs text-slate-500">{v.createdBy}</div>
              </button>
            </li>
          ))}
          {versions.length === 0 && <li className="text-xs text-slate-400">Geen versies.</li>}
        </ul>
      </Card>
      {viewing && (
        <Card className="md:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Versie v{viewing.version}</h2>
            <div className="flex gap-2">
              {canEdit && (
                <Button variant="secondary" onClick={() => setContent(viewing.content)}>
                  Terugzetten in editor
                </Button>
              )}
              <Button variant="ghost" onClick={() => setViewing(null)}>
                Sluiten
              </Button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">{viewing.content}</pre>
        </Card>
      )}
    </div>
  );
}
