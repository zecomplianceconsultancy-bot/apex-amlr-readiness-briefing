"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { Button } from "./ui";

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        await api("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
        router.replace("/login");
        router.refresh();
      }}
    >
      Uitloggen
    </Button>
  );
}
