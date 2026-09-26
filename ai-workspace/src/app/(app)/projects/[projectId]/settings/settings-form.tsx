"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ClientModel } from "@/server/ai/catalog";
import { Button, Card, ClassificationBadge, ErrorText, Input, Label, Select } from "@/components/ui";
import { api } from "@/lib/api-client";
import { CLASSIFICATION_LABELS, ROLE_LABELS } from "@/lib/format";

interface Props {
  projectId: string;
  isOwner: boolean;
  project: { name: string; description: string; classification: string; piiRedaction: boolean; defaultModelId: string | null };
  models: ClientModel[];
  registry: { id: string; label: string; clearance: string }[];
  members: { userId: string; name: string; email: string; role: string }[];
}

export function SettingsForm({ projectId, isOwner, project, models, registry, members }: Props) {
  const router = useRouter();
  const [form, setForm] = useState(project);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await api(`/api/v1/projects/${projectId}`, { method: "PATCH", json: form });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt.");
    } finally {
      setPending(false);
    }
  }

  async function addMember(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    try {
      await api(`/api/v1/projects/${projectId}/members`, { method: "POST", json: { email: f.get("email"), role: f.get("role") } });
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toevoegen mislukt.");
    }
  }

  return (
    <div className="space-y-6">
      <ErrorText>{error}</ErrorText>
      <Card>
        <fieldset disabled={!isOwner || pending} className="space-y-4">
          {!isOwner && <p className="text-sm text-slate-500">Alleen eigenaren kunnen instellingen wijzigen.</p>}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <Label>Naam</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="block">
              <Label>Omschrijving</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <label className="block">
              <Label>Dataclassificatie</Label>
              <Select value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })}>
                {Object.entries(CLASSIFICATION_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block">
              <Label>Standaardmodel</Label>
              <Select value={form.defaultModelId ?? ""} onChange={(e) => setForm({ ...form, defaultModelId: e.target.value || null })}>
                <option value="">Systeemstandaard</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.available}>
                    {m.label}
                    {!m.available ? " — niet beschikbaar" : ""}
                  </option>
                ))}
              </Select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.piiRedaction} onChange={(e) => setForm({ ...form, piiRedaction: e.target.checked })} className="h-4 w-4" />
            Persoonsgegevens (e-mail, IBAN, BSN, telefoon, kaartnummers) maskeren vóór verzending naar een model
          </label>
          {isOwner && (
            <div className="flex items-center gap-3">
              <Button onClick={save}>{pending ? "Opslaan…" : "Opslaan"}</Button>
              {saved && <span className="text-sm text-emerald-700">Opgeslagen</span>}
            </div>
          )}
        </fieldset>
      </Card>

      <Card>
        <h2 className="mb-1 font-medium">Model-clearance</h2>
        <p className="mb-3 text-sm text-slate-500">
          Een model mag alleen data ontvangen tot en met zijn clearance-niveau. Dit wordt server-side afgedwongen bij elke aanroep.
        </p>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {registry.map((m) => {
              const availability = models.find((x) => x.id === m.id);
              return (
                <tr key={m.id}>
                  <td className="py-1.5">{m.label}</td>
                  <td className="py-1.5">
                    <ClassificationBadge value={m.clearance} />
                  </td>
                  <td className="py-1.5 text-xs text-slate-500">{availability?.available ? "beschikbaar" : availability?.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card>
        <h2 className="mb-3 font-medium">Leden</h2>
        <ul className="mb-4 divide-y divide-slate-100 text-sm">
          {members.map((m) => (
            <li key={m.userId} className="flex justify-between py-1.5">
              <span>
                {m.name} <span className="text-slate-500">({m.email})</span>
              </span>
              <span className="text-slate-600">{ROLE_LABELS[m.role]}</span>
            </li>
          ))}
        </ul>
        {isOwner && (
          <form onSubmit={addMember} className="flex items-end gap-2">
            <label className="block flex-1">
              <Label>Lid toevoegen / rol wijzigen</Label>
              <Input name="email" type="email" placeholder="e-mail van bestaande gebruiker" required />
            </label>
            <Select name="role" defaultValue="editor" className="w-36">
              <option value="viewer">Lezer</option>
              <option value="editor">Bewerker</option>
              <option value="owner">Eigenaar</option>
            </Select>
            <Button type="submit">Toevoegen</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
