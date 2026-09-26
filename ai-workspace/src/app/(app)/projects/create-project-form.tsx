"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, ErrorText, Input, Label, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api-client";
import { CLASSIFICATION_LABELS } from "@/lib/format";

export function CreateProjectForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const { project } = await api<{ project: { id: string } }>("/api/v1/projects", {
        method: "POST",
        json: {
          name: f.get("name"),
          description: f.get("description") || undefined,
          classification: f.get("classification"),
          piiRedaction: f.get("piiRedaction") === "on",
          context: f.get("context") || undefined,
        },
      });
      router.push(`/projects/${project.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aanmaken mislukt.");
      setPending(false);
    }
  }

  return (
    <Card className="h-fit">
      <h2 className="mb-4 font-medium">Nieuw project</h2>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block">
          <Label>Naam</Label>
          <Input name="name" required maxLength={120} />
        </label>
        <label className="block">
          <Label>Omschrijving</Label>
          <Input name="description" maxLength={2000} />
        </label>
        <label className="block">
          <Label hint="bepaalt welke modellen data mogen ontvangen">Dataclassificatie</Label>
          <Select name="classification" defaultValue="internal">
            {Object.entries(CLASSIFICATION_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="piiRedaction" defaultChecked className="h-4 w-4 rounded border-slate-300" />
          Persoonsgegevens maskeren vóór verzending
        </label>
        <label className="block">
          <Label hint="optioneel">Projectcontext / instructies</Label>
          <Textarea name="context" rows={4} placeholder="Bijv. doel, doelgroep, toon, definities, randvoorwaarden…" />
        </label>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Bezig…" : "Project aanmaken"}
        </Button>
      </form>
    </Card>
  );
}
