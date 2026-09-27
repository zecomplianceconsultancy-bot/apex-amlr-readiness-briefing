import { z } from "zod";
import { runCompare, runResearch } from "@/server/ai/workflows/runs";
import { authed, parseId, parseJson } from "@/server/http/api";
import { sseResponse } from "@/server/http/sse";

type Params = { projectId: string; conversationId: string };

const modelId = z.string().min(1).max(200);
const runSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("compare"),
    question: z.string().trim().min(1).max(100_000),
    modelIds: z.array(modelId).min(2).max(4),
    judgeModelId: modelId.nullable().optional(),
  }),
  z.object({
    kind: z.literal("research"),
    question: z.string().trim().min(1).max(100_000),
    research: modelId,
    draft: modelId,
    review: modelId.nullable().optional(),
    factcheck: modelId.nullable().optional(),
    final: modelId.nullable().optional(),
  }),
]);

/**
 * Starts a multi-model run and streams it as Server-Sent Events:
 *   run → step-start / step-delta / step-done (per step) → done   (or error)
 */
export const POST = authed<Params>(async (req, { user, params, meta }) => {
  const body = await parseJson(req, runSchema);
  const input = {
    user,
    meta,
    projectId: parseId(params.projectId, "Project"),
    conversationId: parseId(params.conversationId, "Gesprek"),
    question: body.question,
    signal: req.signal,
  };
  return sseResponse(
    body.kind === "compare"
      ? runCompare(input, { modelIds: body.modelIds, judgeModelId: body.judgeModelId })
      : runResearch(input, { research: body.research, draft: body.draft, review: body.review, factcheck: body.factcheck, final: body.final }),
  );
});
