import "server-only";
import { eq } from "drizzle-orm";
import type { RequestMeta } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import { requireProjectRole } from "@/server/authz/project-access";
import { env } from "@/server/config/env";
import { DEFAULT_CONVERSATION_TITLE, getConversation } from "@/server/conversations/service";
import { db, schema } from "@/server/db/client";
import { HttpError } from "@/server/http/errors";
import { buildChatContext, includedDocumentChars } from "./context-builder";
import { streamInvocation } from "./gateway";
import { findModel } from "./registry";
import { router } from "./router";
import { ProviderError, type Citation, type Approval, type FinishReason, type Handoff } from "./types";

/**
 * Orchestrator — turns a user intent into one or more gateway invocations.
 *
 * MVP: a single-model chat turn. The same shape extends to multi-step pipelines
 * (research → analysis → drafting → QA by a second model → consolidation), where each step is
 * a gateway invocation with its own `purpose`, linked through a workflow run id, and where
 * disagreement between steps is surfaced instead of hidden.
 */

export type ChatTurnEvent =
  | {
      type: "meta";
      userMessageId: string;
      assistantMessageId: string;
      invocationId: string;
      model: { id: string; label: string };
      routing: { strategy: string; reason: string };
      redactions: number;
      warnings: string[];
    }
  | { type: "delta"; text: string }
  | { type: "handoff"; handoff: Handoff }
  | { type: "approval"; approval: Approval }
  | {
      type: "done";
      /** Final answer text; authoritative over the concatenated deltas. */
      text: string;
      citations: Citation[];
      finishReason: FinishReason;
      modelReported: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
      latencyMs: number;
    };

export interface ChatTurnInput {
  user: SessionUser;
  meta: RequestMeta;
  projectId: string;
  conversationId: string;
  content: string;
  modelId?: string | null;
  signal?: AbortSignal;
}

const USER_FACING_PROVIDER_ERRORS: Record<string, string> = {
  auth: "De provider weigerde de API-key. Controleer de configuratie.",
  human_check: "De site vraagt om een menselijke controle.",
  permission: "Geen toestemming voor browserbesturing.",
  rate_limit: "De provider is tijdelijk overbelast (rate limit). Probeer het zo opnieuw.",
  timeout: "De provider reageerde niet op tijd.",
  unavailable: "De provider is tijdelijk niet bereikbaar.",
  bad_request: "De provider weigerde het verzoek.",
  cancelled: "Geannuleerd.",
  unknown: "Onbekende fout bij de provider.",
};

/**
 * Common start of every turn (chat or multi-model run): access check (≥ editor), conversation
 * belongs to the project, store the user message, bump the conversation (title on first turn).
 */
export async function startTurn(input: { user: SessionUser; projectId: string; conversationId: string; content: string }) {
  const { project } = await requireProjectRole(input.user, input.projectId, "editor");
  const conversation = await getConversation(project.id, input.conversationId);
  const [userMessage] = await db()
    .insert(schema.messages)
    .values({ conversationId: conversation.id, projectId: project.id, role: "user", content: input.content, authorId: input.user.id })
    .returning({ id: schema.messages.id });
  const isFirstTurn = conversation.title === DEFAULT_CONVERSATION_TITLE;
  await db()
    .update(schema.conversations)
    .set({
      updatedAt: new Date(),
      ...(isFirstTurn ? { title: input.content.replace(/\s+/g, " ").trim().slice(0, 60) || "Gesprek" } : {}),
    })
    .where(eq(schema.conversations.id, conversation.id));
  return { project, conversation, userMessageId: userMessage!.id };
}

export function providerErrorMessage(err: ProviderError): string {
  if (err.provider === "browser" && err.code !== "cancelled") return err.message;
  return USER_FACING_PROVIDER_ERRORS[err.code] ?? err.message;
}

export async function* runChatTurn(input: ChatTurnInput): AsyncGenerator<ChatTurnEvent> {
  // Route before storing anything, so an unknown model is rejected without side effects.
  const { project: access } = await requireProjectRole(input.user, input.projectId, "editor");
  const routing = router.route({
    task: "chat",
    requestedModelId: input.modelId,
    projectDefaultModelId: access.defaultModelId,
    classification: access.classification,
    question: input.content,
    contextChars: input.modelId ? 0 : await includedDocumentChars(access.id),
  });
  const { project, conversation, userMessageId } = await startTurn(input);
  const userMessage = { id: userMessageId };

  // Browser tools accept far less input than APIs: size the context to the chosen engine.
  const model = findModel(routing.modelId);
  const total = Math.min(env().MAX_CONTEXT_CHARS, model?.maxInputChars ?? Number.POSITIVE_INFINITY);
  const context = await buildChatContext(project, conversation.id, {
    documents: Math.floor(total * 0.55),
    history: Math.floor(total * 0.3),
  });

  let assistantMessageId: string | undefined;
  let text = "";
  const saveAssistant = async (status: "complete" | "error" | "cancelled", invocationId: string | null) => {
    if (!assistantMessageId) return;
    await db()
      .update(schema.messages)
      .set({ content: text, status, invocationId })
      .where(eq(schema.messages.id, assistantMessageId));
  };

  let invocationId: string | null = null;
  try {
    for await (const ev of streamInvocation({
      user: input.user,
      meta: input.meta,
      project: { id: project.id, classification: project.classification, piiRedaction: project.piiRedaction },
      conversationId: conversation.id,
      purpose: "chat",
      routing,
      system: context.system,
      messages: context.history,
      contextRefs: { ...context.refs, userMessageId: userMessage.id },
      signal: input.signal,
    })) {
      if (ev.type === "started") {
        invocationId = ev.invocationId;
        const [assistant] = await db()
          .insert(schema.messages)
          .values({ conversationId: conversation.id, projectId: project.id, role: "assistant", content: "", status: "streaming", invocationId })
          .returning({ id: schema.messages.id });
        assistantMessageId = assistant!.id;
        yield {
          type: "meta",
          userMessageId: userMessage.id,
          assistantMessageId,
          invocationId,
          model: { id: ev.model.id, label: ev.model.label },
          routing: { strategy: routing.strategy, reason: routing.reason },
          redactions: ev.redaction.total,
          warnings: context.warnings,
        };
      } else if (ev.type === "text") {
        text += ev.text;
        yield { type: "delta", text: ev.text };
      } else if (ev.type === "handoff") {
        yield { type: "handoff", handoff: ev.handoff };
      } else if (ev.type === "approval") {
        yield { type: "approval", approval: ev.approval };
      } else {
        text = ev.result.text || text;
        await saveAssistant("complete", invocationId);
        yield {
          type: "done",
          text,
          citations: ev.result.citations,
          finishReason: ev.result.finishReason,
          modelReported: ev.result.modelReported,
          inputTokens: ev.result.usage.inputTokens,
          outputTokens: ev.result.usage.outputTokens,
          latencyMs: ev.latencyMs,
        };
      }
    }
  } catch (err) {
    if (err instanceof ProviderError) {
      await saveAssistant(err.code === "cancelled" ? "cancelled" : "error", invocationId);
      throw new HttpError(502, `provider_${err.code}`, providerErrorMessage(err));
    }
    await saveAssistant("error", invocationId);
    throw err;
  } finally {
    // Stream abandoned by the consumer: keep the partial answer, marked as cancelled.
    const [row] = assistantMessageId
      ? await db().select({ status: schema.messages.status }).from(schema.messages).where(eq(schema.messages.id, assistantMessageId))
      : [];
    if (row?.status === "streaming") await saveAssistant("cancelled", invocationId);
  }
}
