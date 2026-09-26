import "server-only";
import { evaluateEgress, type Classification } from "@/server/security/data-policy";
import { getProvider } from "./providers";
import { findModel, MODEL_REGISTRY, type ModelDefinition } from "./registry";

export interface ModelAvailability {
  model: ModelDefinition;
  available: boolean;
  reason?: string;
}

/** Can this model be used for a project with this classification right now? */
export function checkModel(modelId: string, classification: Classification): ModelAvailability | undefined {
  const model = findModel(modelId);
  if (!model) return undefined;
  const provider = getProvider(model.provider);
  if (!provider) return { model, available: false, reason: "Provider niet geregistreerd." };
  if (!provider.isConfigured()) return { model, available: false, reason: `${provider.displayName} is niet geconfigureerd (API-key ontbreekt).` };
  const decision = evaluateEgress(classification, model.clearance);
  if (!decision.allowed) return { model, available: false, reason: decision.reason };
  return { model, available: true };
}

export function listModelsFor(classification: Classification): ModelAvailability[] {
  return MODEL_REGISTRY.map((m) => checkModel(m.id, classification)!);
}

/** Public shape for the browser (no internal fields). */
export function toClientModel(a: ModelAvailability) {
  return {
    id: a.model.id,
    label: a.model.label,
    provider: a.model.provider,
    transport: a.model.transport,
    description: a.model.description,
    clearance: a.model.clearance,
    available: a.available,
    reason: a.reason ?? null,
  };
}
export type ClientModel = ReturnType<typeof toClientModel>;
