"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Kopieer" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-slate-500 hover:text-slate-800"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard not available (e.g. insecure context); ignore
        }
      }}
    >
      {copied ? "Gekopieerd ✓" : label}
    </button>
  );
}
