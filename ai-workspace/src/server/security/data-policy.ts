/**
 * Data egress policy: which project data may be sent to which model.
 *
 * Every project carries a classification; every model in the registry declares the highest
 * classification it is cleared for (based on the provider contract: DPA, retention, region,
 * zero-data-retention, self-hosted, ...). The gateway refuses any call where the project is
 * more sensitive than the model's clearance. This check is enforced server-side for every
 * invocation, independent of what the UI shows.
 */

export const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export function classificationRank(c: Classification): number {
  return CLASSIFICATIONS.indexOf(c);
}

export type PolicyDecision =
  | { allowed: true; projectClassification: Classification; modelClearance: Classification }
  | { allowed: false; projectClassification: Classification; modelClearance: Classification; reason: string };

const LABELS: Record<Classification, string> = { public: "Publiek", internal: "Intern", confidential: "Vertrouwelijk", restricted: "Strikt vertrouwelijk" };

export function evaluateEgress(projectClassification: Classification, modelClearance: Classification): PolicyDecision {
  if (classificationRank(projectClassification) <= classificationRank(modelClearance)) {
    return { allowed: true, projectClassification, modelClearance };
  }
  return {
    allowed: false,
    projectClassification,
    modelClearance,
    reason: `Project is "${LABELS[projectClassification]}"; dit model mag alleen gegevens tot en met "${LABELS[modelClearance]}" krijgen (de classificatie staat onder Instellingen van het project).`,
  };
}
