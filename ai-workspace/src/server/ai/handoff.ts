import "server-only";
import { randomToken } from "@/server/security/crypto";
import { ProviderError } from "./types";

/**
 * Open hand-offs of the manual bridge: the engine waits until the user pastes the answer
 * they got from the tool in their own browser. In memory: a hand-off lives only as long as
 * the request that waits for it (single desktop instance).
 */
interface Pending {
  userId: string;
  resolve: (text: string) => void;
  reject: (err: ProviderError) => void;
  timer: ReturnType<typeof setTimeout>;
}

const g = globalThis as unknown as { __aiwHandoffs?: Map<string, Pending> };
const pending: Map<string, Pending> = (g.__aiwHandoffs ??= new Map());

export const HANDOFF_TIMEOUT_MS = 30 * 60_000;

export function openHandoff(userId: string, signal?: AbortSignal, timeoutMs = HANDOFF_TIMEOUT_MS): { id: string; answer: Promise<string> } {
  const id = randomToken(16);
  const answer = new Promise<string>((resolve, reject) => {
    const done = () => {
      clearTimeout(entry.timer);
      pending.delete(id);
    };
    const entry: Pending = {
      userId,
      resolve: (text) => {
        done();
        resolve(text);
      },
      reject: (err) => {
        done();
        reject(err);
      },
      timer: setTimeout(() => entry.reject(new ProviderError("manual", "timeout", "Geen antwoord geplakt binnen 30 minuten.")), timeoutMs),
    };
    pending.set(id, entry);
    signal?.addEventListener("abort", () => entry.reject(new ProviderError("manual", "cancelled", "Request cancelled")), { once: true });
  });
  return { id, answer };
}

/** Returns false when the hand-off does not exist (anymore) or belongs to someone else. */
export function completeHandoff(id: string, userId: string, text: string): boolean {
  const entry = pending.get(id);
  if (!entry || entry.userId !== userId) return false;
  entry.resolve(text);
  return true;
}

export function cancelHandoff(id: string, userId: string): boolean {
  const entry = pending.get(id);
  if (!entry || entry.userId !== userId) return false;
  entry.reject(new ProviderError("manual", "cancelled", "Request cancelled"));
  return true;
}
