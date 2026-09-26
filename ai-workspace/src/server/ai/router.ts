import "server-only";
import { env } from "@/server/config/env";
import type { Classification } from "@/server/security/data-policy";
import { HttpError } from "@/server/http/errors";
import { checkModel, listModelsFor } from "./catalog";

export type RoutingStrategy = "manual" | "project-default" | "system-default" | "first-available";

export interface RoutingInput {
  task: "chat";
  requestedModelId?: string | null;
  projectDefaultModelId?: string | null;
  classification: Classification;
}

export interface RoutingDecision {
  modelId: string;
  strategy: RoutingStrategy;
  reason: string;
}

/**
 * Routing is an interface so the selection strategy can evolve without touching callers:
 *   MVP      → DefaultRouter: explicit choice → project default → system default.
 *   Later    → rule-based router (task type, tags, cost, classification),
 *              classifier router (small model labels the task), or workflow-defined routing.
 * Every decision is stored with the invocation, so "why this model?" is always answerable.
 */
export interface ModelRouter {
  route(input: RoutingInput): RoutingDecision;
}

export class DefaultRouter implements ModelRouter {
  route(input: RoutingInput): RoutingDecision {
    // An explicit user choice is honoured or refused — never silently substituted. Policy is
    // deliberately not checked here: the gateway enforces it and records the refusal.
    if (input.requestedModelId) {
      const a = checkModel(input.requestedModelId, input.classification);
      if (!a) throw new HttpError(400, "unknown_model", `Onbekend model: ${input.requestedModelId}`);
      return { modelId: a.model.id, strategy: "manual", reason: "Gekozen door gebruiker." };
    }
    if (input.projectDefaultModelId && checkModel(input.projectDefaultModelId, input.classification)?.available) {
      return { modelId: input.projectDefaultModelId, strategy: "project-default", reason: "Standaardmodel van het project." };
    }
    const systemDefault = env().DEFAULT_MODEL_ID;
    if (checkModel(systemDefault, input.classification)?.available) {
      return { modelId: systemDefault, strategy: "system-default", reason: "Systeem-standaardmodel." };
    }
    const first = listModelsFor(input.classification).find((m) => m.available);
    if (first) return { modelId: first.model.id, strategy: "first-available", reason: "Eerste beschikbare model." };
    throw new HttpError(409, "no_model_available", "Geen model beschikbaar voor dit project (controleer API-keys en classificatie).");
  }
}

export const router: ModelRouter = new DefaultRouter();
