import "server-only";
import { randomToken } from "@/server/security/crypto";
import { ProviderError } from "./types";

/**
 * Things an engine waits for from the user: a pasted answer (manual bridge) or a permission
 * decision. In memory: a pending item lives only as long as the request that waits for it.
 */
export type PendingKind = "handoff" | "approval";

interface Pending {
  kind: PendingKind;
  userId: string;
  meta: Record<string, unknown>;
  resolve: (value: string) => void;
  reject: (err: ProviderError) => void;
}

const g = globalThis as unknown as { __aiwPending?: Map<string, Pending> };
const pending: Map<string, Pending> = (g.__aiwPending ??= new Map());

export function openPending(
  kind: PendingKind,
  userId: string,
  opts: { signal?: AbortSignal; timeoutMs: number; timeoutMessage: string; meta?: Record<string, unknown> },
) {
  const id = randomToken(16);
  const value = new Promise<string>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const settle = () => {
      clearTimeout(timer);
      pending.delete(id);
    };
    const entry: Pending = {
      kind,
      userId,
      meta: opts.meta ?? {},
      resolve: (v) => {
        settle();
        resolve(v);
      },
      reject: (err) => {
        settle();
        reject(err);
      },
    };
    timer = setTimeout(() => entry.reject(new ProviderError("user", "timeout", opts.timeoutMessage)), opts.timeoutMs);
    pending.set(id, entry);
    opts.signal?.addEventListener("abort", () => entry.reject(new ProviderError("user", "cancelled", "Request cancelled")), { once: true });
  });
  return { id, value };
}

/** Only the user the item was opened for can settle it. Returns the item's metadata, or null. */
export function resolvePending(kind: PendingKind, id: string, userId: string, value: string): Record<string, unknown> | null {
  const entry = pending.get(id);
  if (!entry || entry.kind !== kind || entry.userId !== userId) return null;
  entry.resolve(value);
  return entry.meta;
}

export function cancelPending(kind: PendingKind, id: string, userId: string): boolean {
  const entry = pending.get(id);
  if (!entry || entry.kind !== kind || entry.userId !== userId) return false;
  entry.reject(new ProviderError("user", "cancelled", "Request cancelled"));
  return true;
}
