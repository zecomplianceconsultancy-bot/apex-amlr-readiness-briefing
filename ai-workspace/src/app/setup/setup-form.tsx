"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, ErrorText, Input, Label } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";

export function SetupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("password2")) return setError("De wachtwoorden zijn niet gelijk.");
    setPending(true);
    setError(null);
    try {
      await api("/api/v1/setup", { method: "POST", json: { name: f.get("name"), email: f.get("email"), password: f.get("password") } });
      router.replace("/projects");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError && err.code === "bad_request" ? "Controleer de velden (wachtwoord minimaal 12 tekens)." : err instanceof Error ? err.message : "Mislukt.");
      setPending(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <Label>Naam</Label>
          <Input name="name" required autoFocus />
        </label>
        <label className="block">
          <Label>E-mail</Label>
          <Input name="email" type="email" autoComplete="username" required />
        </label>
        <label className="block">
          <Label hint="minimaal 12 tekens">Wachtwoord</Label>
          <Input name="password" type="password" autoComplete="new-password" minLength={12} required />
        </label>
        <label className="block">
          <Label>Herhaal wachtwoord</Label>
          <Input name="password2" type="password" autoComplete="new-password" minLength={12} required />
        </label>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={pending} className="w-full py-2">
          {pending ? "Bezig…" : "Account aanmaken"}
        </Button>
      </form>
    </Card>
  );
}
