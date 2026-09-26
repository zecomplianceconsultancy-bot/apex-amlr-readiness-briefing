import "server-only";
import { eq } from "drizzle-orm";
import type { RequestMeta } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import { requireProjectRole } from "@/server/authz/project-access";
import { env } from "@/server/config/env";
import { DEFAULT_CONVERSATION_TITLE, getConversation } from "@/server/conversations/service";
import { db, schema } from "@/server/db/client";
import { HttpError } from "@/server/http/errors";
import { buildChatContext } from "./context-builder";
import { streamInvocation } from "./gateway";
import { findModel } from "./registry";
import { router } from "./router";
import { ProviderError, type Citation, type FinishReason } from "./types";

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
  rate_limit: "De provider is tijdelijk overbelast (rate limit). Probeer het zo opnieuw.",
  timeout: "De provider reageerde niet op tijd.",
  unavailable: "De provider is tijdelijk niet bereikbaar.",
  bad_request: "De provider weigerde het verzoek.",
  cancelled: "Geannuleerd.",
  unknown: "Onbekende fout bij de provider.",
};

export async function* runChatTurn(input: ChatTurnInput): AsyncGenerator<ChatTurnEvent> {
  const { project } = await requireProjectRole(input.user, input.projectId, "editor");
  const conversation = await getConversation(project.id, input.conversationId);

  const routing = router.route({
    task: "chat",
    requestedModelId: input.modelId,
    projectDefaultModelId: project.defaultModelId,
    classification: project.classification,
  });

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
      contextRefs: { ...context.refs, userMessageId: userMessage!.id },
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
          userMessageId: userMessage!.id,
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
      throw new HttpError(502, `provider_${err.code}`, USER_FACING_PROVIDER_ERRORS[err.code] ?? err.message);
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
