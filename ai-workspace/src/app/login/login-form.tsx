"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, ErrorText, Input, Label } from "@/components/ui";
import { api } from "@/lib/api-client";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api("/api/v1/auth/login", { method: "POST", json: { email: form.get("email"), password: form.get("password") } });
      router.replace("/projects");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inloggen mislukt.");
      setPending(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <Label>E-mail</Label>
          <Input name="email" type="email" autoComplete="username" required autoFocus />
        </label>
        <label className="block">
          <Label>Wachtwoord</Label>
          <Input name="password" type="password" autoComplete="current-password" required />
        </label>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={pending} className="w-full py-2">
          {pending ? "Bezig…" : "Inloggen"}
        </Button>
      </form>
    </Card>
  );
}
