import "server-only";
import { evaluateEgress, type Classification } from "@/server/security/data-policy";
import { siteStatuses } from "./browser/session";
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
  // Browser tools that failed their last check (not logged in / page changed) are not offered.
  if (model.transport === "browser") {
    const status = siteStatuses()[model.providerModel];
    if (status && status.state !== "ready") return { model, available: false, reason: `${model.label}: ${status.state === "login_required" ? "inloggen nodig" : status.state === "human_check" ? "menselijke controle nodig" : "fout bij laatste controle"} (zie Browser-tools).` };
  }
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
    strengths: a.model.strengths,
    tags: [...a.model.tags],
    clearance: a.model.clearance,
    available: a.available,
    reason: a.reason ?? null,
  };
}
export type ClientModel = ReturnType<typeof toClientModel>;
