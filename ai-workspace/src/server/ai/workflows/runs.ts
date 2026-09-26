import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { RequestMeta } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import type { ProjectRow } from "@/server/authz/project-access";
import { env } from "@/server/config/env";
import { db, schema } from "@/server/db/client";
import { HttpError } from "@/server/http/errors";
import { buildChatContext, type BuiltContext } from "../context-builder";
import { streamInvocation } from "../gateway";
import { providerErrorMessage, startTurn } from "../orchestrator";
import { findModel } from "../registry";
import { ProviderError, type ChatMessage, type Approval, type Citation, type Handoff } from "../types";
import { mergeGenerators } from "./merge";
import { draftPrompt, factcheckPrompt, finalPrompt, judgePrompt, parseVerdict, researchPrompt, reviewPrompt, type VerdictKey } from "./prompts";

/**
 * Multi-model workflows. Each step is an ordinary gateway invocation (policy, masking,
 * provenance, audit per step); a run ties the steps together and ends in one assistant message.
 *
 *  compare:  N models answer in parallel → optional judge lists consensus, differences and
 *            likely errors, and writes a merged answer.
 *  research: research (web/sources) → draft → independent review → final edit.
 */

export type RunKind = "compare" | "research";
export type StepRole = "answer" | "judge" | "research" | "draft" | "review" | "factcheck" | "final";

export interface RunStepInfo {
  id: string;
  position: number;
  role: StepRole;
  modelId: string;
  label: string;
}

export type RunEvent =
  | { type: "run"; runId: string; kind: RunKind; userMessageId: string; assistantMessageId: string; steps: RunStepInfo[]; warnings: string[] }
  | { type: "step-start"; stepId: string; invocationId: string }
  | { type: "step-delta"; stepId: string; text: string }
  | { type: "step-handoff"; stepId: string; handoff: Handoff }
  | { type: "step-approval"; stepId: string; approval: Approval }
  | { type: "step-done"; stepId: string; status: "complete" | "error" | "cancelled" | "skipped"; text: string; verdict: string | null; citations: Citation[]; error: string | null }
  | { type: "done"; status: "complete" | "error" | "cancelled"; content: string };

export interface CompareInput {
  modelIds: string[];
  judgeModelId?: string | null;
}
export interface ResearchInput {
  research: string;
  draft: string;
  review: string;
  /** Optional independent fact check (e.g. Gemini with Google Search). */
  factcheck?: string | null;
  final: string;
}

export interface RunInput {
  user: SessionUser;
  meta: RequestMeta;
  projectId: string;
  conversationId: string;
  question: string;
  signal?: AbortSignal;
}

interface StepResult {
  ok: boolean;
  cancelled: boolean;
  text: string;
  citations: Citation[];
  verdict: string | null;
}

interface RunContext {
  input: RunInput;
  project: ProjectRow;
  conversationId: string;
  runId: string;
  kind: RunKind;
  refs: Record<string, unknown>;
}

const label = (modelId: string) => findModel(modelId)?.label ?? modelId;

function assertModels(ids: string[]): void {
  for (const id of ids) if (!findModel(id)) throw new HttpError(400, "unknown_model", `Onbekend model: ${id}`);
}

/** Smallest input limit among the engines involved: context must fit all of them. */
function inputBudget(modelIds: string[]): number {
  return Math.min(env().MAX_CONTEXT_CHARS, ...modelIds.map((id) => findModel(id)?.maxInputChars ?? Number.POSITIVE_INFINITY));
}

async function createRun(
  input: RunInput,
  kind: RunKind,
  config: unknown,
  steps: { role: StepRole; modelId: string }[],
): Promise<{ project: ProjectRow; conversationId: string; runId: string; userMessageId: string; assistantMessageId: string; steps: RunStepInfo[] }> {
  const { project, conversation, userMessageId } = await startTurn({ ...input, content: input.question });
  return db().transaction(async (tx) => {
    const [run] = await tx
      .insert(schema.runs)
      .values({ projectId: project.id, conversationId: conversation.id, kind, question: input.question, config, createdBy: input.user.id })
      .returning({ id: schema.runs.id });
    const rows = await tx
      .insert(schema.runSteps)
      .values(steps.map((s, position) => ({ runId: run!.id, position, role: s.role, modelId: s.modelId })))
      .returning({ id: schema.runSteps.id, position: schema.runSteps.position });
    const [assistant] = await tx
      .insert(schema.messages)
      .values({ conversationId: conversation.id, projectId: project.id, role: "assistant", content: "", status: "streaming", runId: run!.id })
      .returning({ id: schema.messages.id });
    return {
      project,
      conversationId: conversation.id,
      runId: run!.id,
      userMessageId,
      assistantMessageId: assistant!.id,
      steps: rows
        .sort((a, b) => a.position - b.position)
        .map((r) => ({ id: r.id, position: r.position, role: steps[r.position]!.role, modelId: steps[r.position]!.modelId, label: label(steps[r.position]!.modelId) })),
    };
  });
}

/** Runs one step through the gateway; never throws for provider/policy failures. */
async function* executeStep(
  ctx: RunContext,
  step: RunStepInfo,
  prompt: { system?: string; messages: ChatMessage[] },
  verdictKey?: VerdictKey,
): AsyncGenerator<RunEvent, StepResult> {
  const steps = schema.runSteps;
  await db().update(steps).set({ status: "running", startedAt: new Date() }).where(eq(steps.id, step.id));
  let text = "";
  let citations: Citation[] = [];
  try {
    for await (const ev of streamInvocation({
      user: ctx.input.user,
      meta: ctx.input.meta,
      project: { id: ctx.project.id, classification: ctx.project.classification, piiRedaction: ctx.project.piiRedaction },
      conversationId: ctx.conversationId,
      purpose: `${ctx.kind}:${step.role}`,
      routing: { modelId: step.modelId, strategy: "workflow", reason: `${ctx.kind === "compare" ? "Vergelijken" : "Diep onderzoek"}: stap ${step.position + 1} (${step.role})` },
      system: prompt.system,
      messages: prompt.messages,
      contextRefs: { ...ctx.refs, runId: ctx.runId, stepId: step.id },
      signal: ctx.input.signal,
    })) {
      if (ev.type === "started") {
        await db().update(steps).set({ invocationId: ev.invocationId }).where(eq(steps.id, step.id));
        yield { type: "step-start", stepId: step.id, invocationId: ev.invocationId };
      } else if (ev.type === "text") {
        text += ev.text;
        yield { type: "step-delta", stepId: step.id, text: ev.text };
      } else if (ev.type === "handoff") {
        yield { type: "step-handoff", stepId: step.id, handoff: ev.handoff };
      } else if (ev.type === "approval") {
        yield { type: "step-approval", stepId: step.id, approval: ev.approval };
      } else {
        text = ev.result.text || text;
        citations = ev.result.citations;
      }
    }
    const verdict = verdictKey ? parseVerdict(text, verdictKey) : null;
    await db().update(steps).set({ status: "complete", output: text, verdict, completedAt: new Date() }).where(eq(steps.id, step.id));
    yield { type: "step-done", stepId: step.id, status: "complete", text, verdict, citations, error: null };
    return { ok: true, cancelled: false, text, citations, verdict };
  } catch (err) {
    const cancelled = err instanceof ProviderError && err.code === "cancelled";
    const message =
      err instanceof ProviderError ? providerErrorMessage(err) : err instanceof HttpError ? err.message : "Onverwachte fout in deze stap.";
    if (!(err instanceof ProviderError) && !(err instanceof HttpError)) console.error("[workflow] step failed", err);
    const status = cancelled ? "cancelled" : "error";
    await db().update(steps).set({ status, output: text, error: message, completedAt: new Date() }).where(eq(steps.id, step.id));
    yield { type: "step-done", stepId: step.id, status, text, verdict: null, citations, error: message };
    return { ok: false, cancelled, text, citations, verdict: null };
  }
}

async function* skip(step: RunStepInfo, reason: string): AsyncGenerator<RunEvent> {
  await db().update(schema.runSteps).set({ status: "skipped", error: reason }).where(eq(schema.runSteps.id, step.id));
  yield { type: "step-done", stepId: step.id, status: "skipped", text: "", verdict: null, citations: [], error: reason };
}

async function finishRun(runId: string, assistantMessageId: string, status: "complete" | "error" | "cancelled", content: string, error?: string) {
  await db().transaction(async (tx) => {
    await tx.update(schema.runs).set({ status, completedAt: new Date(), error: error ?? null }).where(eq(schema.runs.id, runId));
    await tx
      .update(schema.messages)
      .set({ content, status: status === "complete" ? "complete" : status })
      .where(eq(schema.messages.id, assistantMessageId));
  });
}

/** Guarantees the run and its message are closed even if the client disconnects mid-way. */
async function* guarded(runId: string, assistantMessageId: string, body: AsyncGenerator<RunEvent>): AsyncGenerator<RunEvent> {
  let finished = false;
  try {
    for await (const ev of body) {
      if (ev.type === "done") finished = true;
      yield ev;
    }
  } finally {
    if (!finished) {
      await db()
        .update(schema.runSteps)
        .set({ status: "cancelled" })
        .where(and(eq(schema.runSteps.runId, runId), inArray(schema.runSteps.status, ["pending", "running"])));
      await finishRun(runId, assistantMessageId, "cancelled", "", "Afgebroken");
    }
  }
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

export async function* runCompare(input: RunInput, cfg: CompareInput): AsyncGenerator<RunEvent> {
  const modelIds = [...new Set(cfg.modelIds)];
  if (modelIds.length < 2 || modelIds.length > 4) throw new HttpError(400, "bad_request", "Kies 2 tot 4 modellen om te vergelijken.");
  assertModels([...modelIds, ...(cfg.judgeModelId ? [cfg.judgeModelId] : [])]);

  const plan: { role: StepRole; modelId: string }[] = modelIds.map((modelId) => ({ role: "answer", modelId }));
  if (cfg.judgeModelId) plan.push({ role: "judge", modelId: cfg.judgeModelId });
  const run = await createRun(input, "compare", { modelIds, judgeModelId: cfg.judgeModelId ?? null }, plan);

  // Same context for every engine, sized to the most restrictive one.
  const total = inputBudget(modelIds);
  const context: BuiltContext = await buildChatContext(run.project, run.conversationId, {
    documents: Math.floor(total * 0.55),
    history: Math.floor(total * 0.3),
  });
  const ctx: RunContext = { input, project: run.project, conversationId: run.conversationId, runId: run.runId, kind: "compare", refs: { ...context.refs } };

  yield* guarded(
    run.runId,
    run.assistantMessageId,
    (async function* (): AsyncGenerator<RunEvent> {
      yield { type: "run", runId: run.runId, kind: "compare", userMessageId: run.userMessageId, assistantMessageId: run.assistantMessageId, steps: run.steps, warnings: context.warnings };
      const answerSteps = run.steps.filter((s) => s.role === "answer");
      const results = yield* mergeGenerators(answerSteps.map((s) => executeStep(ctx, s, { system: context.system, messages: context.history })));
      const good = answerSteps.map((s, i) => ({ step: s, result: results[i]! })).filter((a) => a.result.ok && a.result.text.trim());
      if (results.some((r) => r.cancelled)) {
        const judge = run.steps.find((s) => s.role === "judge");
        if (judge) yield* skip(judge, "Afgebroken");
        await finishRun(run.runId, run.assistantMessageId, "cancelled", "");
        yield { type: "done", status: "cancelled", content: "" };
        return;
      }

      const answersMarkdown = good.map((a) => `### ${a.step.label}\n\n${a.result.text}`).join("\n\n---\n\n");
      let content = answersMarkdown;
      const judge = run.steps.find((s) => s.role === "judge");
      if (judge) {
        if (good.length < 2) {
          yield* skip(judge, "Te weinig geslaagde antwoorden om te vergelijken.");
        } else {
          const jr = yield* executeStep(
            ctx,
            judge,
            { system: context.system, messages: [{ role: "user", content: judgePrompt(input.question, good.map((a) => ({ label: a.step.label, text: a.result.text }))) }] },
            "OVEREENSTEMMING",
          );
          if (jr.ok && jr.text.trim()) content = jr.text;
        }
      }
      const status: "complete" | "error" = good.length ? "complete" : "error";
      await finishRun(run.runId, run.assistantMessageId, status, content, good.length ? undefined : "Geen enkel model gaf een antwoord.");
      yield { type: "done", status, content };
    })(),
  );
}

// ---------------------------------------------------------------------------
// Research pipeline
// ---------------------------------------------------------------------------

export async function* runResearch(input: RunInput, cfg: ResearchInput): AsyncGenerator<RunEvent> {
  const roles: [StepRole, string][] = [
    ["research", cfg.research],
    ["draft", cfg.draft],
    ["review", cfg.review],
    ...(cfg.factcheck ? ([["factcheck", cfg.factcheck]] as [StepRole, string][]) : []),
    ["final", cfg.final],
  ];
  assertModels(roles.map(([, m]) => m));
  const run = await createRun(input, "research", { ...cfg, factcheck: cfg.factcheck ?? null }, roles.map(([role, modelId]) => ({ role, modelId })));

  // Leave room for quoted earlier-step output: documents get a smaller share here.
  const total = inputBudget(roles.map(([, m]) => m));
  const context = await buildChatContext(run.project, run.conversationId, { documents: Math.floor(total * 0.35), history: 0 });
  const ctx: RunContext = { input, project: run.project, conversationId: run.conversationId, runId: run.runId, kind: "research", refs: { ...context.refs } };
  const step = (role: StepRole) => run.steps.find((s) => s.role === role);
  const after = (role: StepRole) => run.steps.filter((s) => s.position > step(role)!.position);
  const ask = (content: string) => ({ system: context.system, messages: [{ role: "user" as const, content }] });
  const q = input.question;

  yield* guarded(
    run.runId,
    run.assistantMessageId,
    (async function* (): AsyncGenerator<RunEvent> {
      yield { type: "run", runId: run.runId, kind: "research", userMessageId: run.userMessageId, assistantMessageId: run.assistantMessageId, steps: run.steps, warnings: context.warnings };

      const stop = async function* (failed: StepRole, reason: string, result: StepResult, fallback = ""): AsyncGenerator<RunEvent> {
        for (const s of after(failed)) yield* skip(s, reason);
        const status: "complete" | "error" | "cancelled" = result.cancelled ? "cancelled" : fallback ? "complete" : "error";
        const content = result.cancelled ? "" : fallback;
        await finishRun(run.runId, run.assistantMessageId, status, content, content ? undefined : reason);
        yield { type: "done", status, content };
      };

      const research = yield* executeStep(ctx, step("research")!, ask(researchPrompt(q)));
      if (!research.ok) return yield* stop("research", "Onderzoeksstap mislukt.", research);

      const draft = yield* executeStep(ctx, step("draft")!, ask(draftPrompt(q, research.text)));
      if (!draft.ok) return yield* stop("draft", "Uitwerking mislukt.", draft, research.text);

      const review = yield* executeStep(ctx, step("review")!, ask(reviewPrompt(q, research.text, draft.text)), "OORDEEL");
      if (!review.ok) return yield* stop("review", "Controle mislukt; concept zonder review.", review, draft.text);

      let factcheck: StepResult | null = null;
      const fcStep = step("factcheck");
      if (fcStep) {
        factcheck = yield* executeStep(ctx, fcStep, ask(factcheckPrompt(q, draft.text)), "FEITEN");
        if (factcheck.cancelled) return yield* stop("factcheck", "Afgebroken.", factcheck);
        // A failed fact check does not block the answer; the final step simply runs without it.
      }

      const final = yield* executeStep(ctx, step("final")!, ask(finalPrompt(q, draft.text, review.text, factcheck?.ok ? factcheck.text : null)));
      const content = final.cancelled ? "" : final.ok ? final.text : draft.text;
      const status: "complete" | "cancelled" = final.cancelled ? "cancelled" : "complete";
      await finishRun(run.runId, run.assistantMessageId, status, content);
      yield { type: "done", status, content };
    })(),
  );
}

// ---------------------------------------------------------------------------
// Reading runs back (for the conversation view)
// ---------------------------------------------------------------------------

export async function listRunsForConversation(conversationId: string) {
  const runs = await db().select().from(schema.runs).where(eq(schema.runs.conversationId, conversationId));
  if (!runs.length) return {};
  const steps = await db()
    .select({ step: schema.runSteps, citations: schema.modelInvocations.citations })
    .from(schema.runSteps)
    .leftJoin(schema.modelInvocations, eq(schema.modelInvocations.id, schema.runSteps.invocationId))
    .where(inArray(schema.runSteps.runId, runs.map((r) => r.id)))
    .orderBy(asc(schema.runSteps.position));
  return Object.fromEntries(
    runs.map((r) => [
      r.id,
      {
        id: r.id,
        kind: r.kind,
        status: r.status,
        steps: steps
          .filter((s) => s.step.runId === r.id)
          .map(({ step: s, citations }) => ({
            id: s.id,
            position: s.position,
            role: s.role as StepRole,
            modelId: s.modelId,
            label: label(s.modelId),
            status: s.status,
            text: s.output,
            verdict: s.verdict,
            error: s.error,
            invocationId: s.invocationId,
            citations: (citations as Citation[] | null) ?? [],
          })),
      },
    ]),
  );
}
export type ConversationRuns = Awaited<ReturnType<typeof listRunsForConversation>>;
