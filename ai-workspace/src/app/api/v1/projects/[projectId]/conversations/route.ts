import { NextResponse } from "next/server";
import { requireProjectRole } from "@/server/authz/project-access";
import { createConversation, DEFAULT_CONVERSATION_TITLE, listConversations } from "@/server/conversations/service";
import { authed, parseId, parseJson } from "@/server/http/api";
import { createConversationSchema } from "@/server/http/schemas";

type Params = { projectId: string };

export const GET = authed<Params>(async (_req, { user, params }) => {
  const { project } = await requireProjectRole(user, parseId(params.projectId, "Project"), "viewer");
  return NextResponse.json({ conversations: await listConversations(project.id) });
});

export const POST = authed<Params>(async (req, { user, params, meta }) => {
  const { title } = await parseJson(req, createConversationSchema);
  const { project } = await requireProjectRole(user, parseId(params.projectId, "Project"), "editor");
  const conversation = await createConversation(user, project.id, title ?? DEFAULT_CONVERSATION_TITLE, meta);
  return NextResponse.json({ conversation }, { status: 201 });
});
