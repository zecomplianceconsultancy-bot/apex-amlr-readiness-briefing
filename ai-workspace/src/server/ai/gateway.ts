import "server-only";
import { eq } from "drizzle-orm";
import { recordAudit, type RequestMeta } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import { db, schema } from "@/server/db/client";
import { HttpError } from "@/server/http/errors";
import { canonicalJson, sha256Hex } from "@/server/security/crypto";
import { evaluateEgress, type Classification } from "@/server/security/data-policy";
import { Redactor } from "@/server/security/redaction";
import { getProvider } from "./providers";
import { findModel, type ModelDefinition } from "./registry";
import type { RoutingDecision } from "./router";
import { ProviderError, type ChatMessage, type ChatResult, type Handoff } from "./types";

/**
 * AI Gateway — the single choke point between the platform and any AI provider.
 *
 * For every call it: (1) resolves the model, (2) enforces the data egress policy,
 * (3) masks PII when the project requires it, (4) records the exact outbound payload,
 * (5) streams the provider response, (6) records outcome, model version, usage and latency,
 * and (7) writes an audit event. Nothing else in the codebase may call a provider directly.
 */

export interface GatewayCall {
  user: SessionUser;
  meta: RequestMeta;
  project: { id: string; classification: Classification; piiRedaction: boolean };
  conversationId?: string | null;
  /** Why the call is made: "chat" now; later "research", "qa", "consolidate", workflow steps. */
  purpose: string;
  routing: RoutingDecision;
  system?: string;
  messages: ChatMessage[];
  /** What context went in (context version, files + hashes, history size). */
  contextRefs: Record<string, unknown>;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export type GatewayEvent =
  | {
      type: "started";
      invocationId: string;
      model: ModelDefinition;
      redaction: ReturnType<Redactor["summary"]>;
    }
  | { type: "text"; text: string }
  | { type: "handoff"; handoff: Handoff }
  | { type: "completed"; invocationId: string; result: ChatResult; latencyMs: number };

export class PolicyBlockedError extends HttpError {
  constructor(
    reason: string,
    readonly invocationId: string,
  ) {
    super(403, "policy_blocked", reason);
  }
}

const invocations = schema.modelInvocations;

export async function* streamInvocation(call: GatewayCall): AsyncGenerator<GatewayEvent> {
  const model = findModel(call.routing.modelId);
  if (!model) throw new HttpError(400, "unknown_model", `Onbekend model: ${call.routing.modelId}`);
  const provider = getProvider(model.provider);
  if (!provider?.isConfigured()) throw new HttpError(409, "model_unavailable", `Provider ${model.provider} is niet geconfigureerd.`);

  // --- (2) Egress policy, (3) redaction --------------------------------------------------
  const decision = evaluateEgress(call.project.classification, model.clearance);
  const redactor = new Redactor();
  const redact = (s: string) => (call.project.piiRedaction ? redactor.redact(s) : s);
  const system = call.system !== undefined ? redact(call.system) : undefined;
  const messages = call.messages.map((m) => ({ role: m.role, content: redact(m.content) }));
  const redaction = redactor.summary();

  const maxOutputTokens = Math.min(call.maxOutputTokens ?? model.maxOutputTokens, model.maxOutputTokens);
  const payload = { provider: model.provider, providerModel: model.providerModel, maxOutputTokens, system: system ?? null, messages };
  const requestHash = sha256Hex(canonicalJson(payload));
  const policy = { egress: decision, piiRedaction: call.project.piiRedaction, redaction };

  const base = {
    projectId: call.project.id,
    conversationId: call.conversationId ?? null,
    userId: call.user.id,
    purpose: call.purpose,
    provider: model.provider,
    modelId: model.id,
    modelRequested: model.providerModel,
    routing: call.routing,
    params: { maxOutputTokens },
    requestPayload: payload,
    requestHash,
    contextRefs: call.contextRefs,
    policy,
  };

  if (!decision.allowed) {
    const invocationId = await db().transaction(async (tx) => {
      const [row] = await tx
        .insert(invocations)
        .values({ ...base, requestPayload: { withheld: true }, status: "blocked", completedAt: new Date(), errorCode: "policy_blocked", errorMessage: decision.reason })
        .returning({ id: invocations.id });
      await recordAudit(
        {
          action: "ai.invocation.blocked",
          actorUserId: call.user.id,
          projectId: call.project.id,
          entityType: "model_invocation",
          entityId: row!.id,
          details: { modelId: model.id, reason: decision.reason, purpose: call.purpose },
          request: call.meta,
        },
        tx,
      );
      return row!.id;
    });
    throw new PolicyBlockedError(decision.reason, invocationId);
  }

  // --- (4) Record the outbound request before anything leaves the platform ---------------
  const [created] = await db().insert(invocations).values({ ...base, status: "running" }).returning({ id: invocations.id });
  const invocationId = created!.id;
  const startedAt = Date.now();
  let settled = false;
  let partial = "";

  const finish = async (
    status: "success" | "error" | "cancelled",
    fields: Partial<typeof invocations.$inferInsert>,
    auditDetails: Record<string, unknown>,
  ) => {
    settled = true;
    const latencyMs = Date.now() - startedAt;
    await db().transaction(async (tx) => {
      await tx
        .update(invocations)
        .set({ ...fields, status, latencyMs, completedAt: new Date() })
        .where(eq(invocations.id, invocationId));
      await recordAudit(
        {
          action: status === "success" ? "ai.invocation.completed" : status === "cancelled" ? "ai.invocation.cancelled" : "ai.invocation.failed",
          actorUserId: call.user.id,
          projectId: call.project.id,
          entityType: "model_invocation",
          entityId: invocationId,
          details: {
            purpose: call.purpose,
            conversationId: call.conversationId ?? null,
            provider: model.provider,
            modelId: model.id,
            modelReported: fields.modelReported ?? null,
            requestHash,
            routing: call.routing.strategy,
            redactions: redaction.total,
            latencyMs,
            ...auditDetails,
          },
          request: call.meta,
        },
        tx,
      );
    });
    return latencyMs;
  };

  yield { type: "started", invocationId, model, redaction };

  // --- (5) Stream, (6) record outcome -------------------------------------------------
  try {
    for await (const event of provider.streamChat({
      providerModel: model.providerModel,
      system,
      messages,
      maxOutputTokens,
      signal: call.signal,
      context: { userId: call.user.id },
    })) {
      if (event.type === "text") {
        partial += event.text;
        yield event;
      } else if (event.type === "handoff") {
        yield event;
      } else {
        const r = event.result;
        const latencyMs = await finish(
          "success",
          {
            responseText: r.text,
            citations: r.citations,
            modelReported: r.modelReported,
            finishReason: r.finishReason,
            inputTokens: r.usage.inputTokens,
            outputTokens: r.usage.outputTokens,
            providerRequestId: r.providerRequestId,
          },
          { finishReason: r.finishReason, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, citations: r.citations.length },
        );
        yield { type: "completed", invocationId, result: r, latencyMs };
      }
    }
  } catch (err) {
    const pe = err instanceof ProviderError ? err : new ProviderError(model.provider, "unknown", String(err));
    if (!settled) {
      await finish(
        pe.code === "cancelled" ? "cancelled" : "error",
        { responseText: partial || null, errorCode: pe.code, errorMessage: pe.message.slice(0, 2000) },
        { errorCode: pe.code },
      );
    }
    throw pe;
  } finally {
    // Consumer stopped iterating (e.g. client disconnected) without an error being thrown.
    if (!settled) {
      await finish("cancelled", { responseText: partial || null, errorCode: "cancelled" }, { errorCode: "cancelled" });
    }
  }
}
