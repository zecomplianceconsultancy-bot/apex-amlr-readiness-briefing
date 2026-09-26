import "server-only";
import { env } from "@/server/config/env";
import type { Classification } from "@/server/security/data-policy";
import { HttpError } from "@/server/http/errors";
import { bestFor, classifyTask, scoreModel } from "@/lib/strengths";
import { checkModel, listModelsFor } from "./catalog";
import { findModel } from "./registry";

export type RoutingStrategy = "manual" | "project-default" | "auto" | "system-default" | "first-available" | "workflow";

export interface RoutingInput {
  task: "chat";
  requestedModelId?: string | null;
  projectDefaultModelId?: string | null;
  classification: Classification;
  /** The user's message; enables strength-based automatic routing. */
  question?: string;
  /** Size of the project documents that go into the context. */
  contextChars?: number;
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
    // Automatic: pick the engine whose strengths fit the task (lib/strengths.ts).
    if (input.question) {
      const { role, reason } = classifyTask(input.question, input.contextChars);
      const candidates = listModelsFor(input.classification).map((a) => ({ id: a.model.id, tags: a.model.tags, available: a.available }));
      const best = bestFor(role, candidates);
      const model = best ? findModel(best) : undefined;
      if (model && scoreModel({ id: model.id, tags: model.tags, available: true }, role) > 0) {
        return { modelId: model.id, strategy: "auto", reason: `${reason} → ${model.label}: ${model.strengths}` };
      }
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
