"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";

export interface UIApproval {
  approvalId: string;
  tool: string;
  toolLabel: string;
  action: string;
}

/** Nothing is opened or operated on this computer until the user decides here. */
export function ApprovalCard({ approval }: { approval: UIApproval }) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "once" | "session" | "deny") {
    setState("sending");
    setError(null);
    try {
      await api(`/api/v1/approvals/${approval.approvalId}`, { method: "POST", json: { decision } });
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mislukt.");
      setState("idle");
    }
  }

  if (state === "done") return <p className="text-sm text-slate-500">Beslissing ontvangen…</p>;
  return (
    <div className="space-y-2 rounded-xl border-2 border-indigo-300 bg-indigo-50/60 p-3 text-sm">
      <p className="font-medium text-indigo-900">🔒 Toestemming gevraagd</p>
      <p className="text-slate-700">{approval.action}</p>
      <p className="text-xs text-slate-500">Er gebeurt niets totdat je kiest. Je kunt ook weigeren en de handmatige route gebruiken.</p>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={state === "sending"} onClick={() => void decide("once")} className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white">
          Eenmalig toestaan
        </button>
        <button type="button" disabled={state === "sending"} onClick={() => void decide("session")} className="rounded-lg px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-300">
          Toestaan tot ik de workspace afsluit
        </button>
        <button type="button" disabled={state === "sending"} onClick={() => void decide("deny")} className="rounded-lg px-3 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-300">
          Weigeren
        </button>
      </div>
    </div>
  );
}
