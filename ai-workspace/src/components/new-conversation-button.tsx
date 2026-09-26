"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { Button } from "./ui";

export function NewConversationButton({ projectId, className }: { projectId: string; className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      className={className}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          const { conversation } = await api<{ conversation: { id: string } }>(`/api/v1/projects/${projectId}/conversations`, { method: "POST", json: {} });
          router.push(`/projects/${projectId}/c/${conversation.id}`);
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      + Nieuw gesprek
    </Button>
  );
}
