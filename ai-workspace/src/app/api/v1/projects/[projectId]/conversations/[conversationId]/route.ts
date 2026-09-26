import { NextResponse } from "next/server";
import { requireProjectRole } from "@/server/authz/project-access";
import { getConversation, listMessages, updateConversation } from "@/server/conversations/service";
import { authed, parseId, parseJson } from "@/server/http/api";
import { updateConversationSchema } from "@/server/http/schemas";

type Params = { projectId: string; conversationId: string };

export const GET = authed<Params>(async (_req, { user, params }) => {
  const { project } = await requireProjectRole(user, parseId(params.projectId, "Project"), "viewer");
  const conversation = await getConversation(project.id, parseId(params.conversationId, "Gesprek"));
  return NextResponse.json({ conversation, messages: await listMessages(conversation.id) });
});

export const PATCH = authed<Params>(async (req, { user, params, meta }) => {
  const patch = await parseJson(req, updateConversationSchema);
  const { project } = await requireProjectRole(user, parseId(params.projectId, "Project"), "editor");
  await updateConversation(user, project.id, parseId(params.conversationId, "Gesprek"), patch, meta);
  return NextResponse.json({ ok: true });
});
