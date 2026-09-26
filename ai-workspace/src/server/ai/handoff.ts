import "server-only";
import { cancelPending, openPending, resolvePending } from "./pending";

/** Manual bridge: the engine waits until the user pastes the answer from the tool. */
export const HANDOFF_TIMEOUT_MS = 30 * 60_000;

export function openHandoff(userId: string, signal?: AbortSignal, timeoutMs = HANDOFF_TIMEOUT_MS): { id: string; answer: Promise<string> } {
  const { id, value } = openPending("handoff", userId, { signal, timeoutMs, timeoutMessage: "Geen antwoord geplakt binnen 30 minuten." });
  return { id, answer: value };
}

export const completeHandoff = (id: string, userId: string, text: string) => resolvePending("handoff", id, userId, text) !== null;
export const cancelHandoff = (id: string, userId: string) => cancelPending("handoff", id, userId);
