import "server-only";
import type { RequestMeta } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import { requireProjectRole } from "@/server/authz/project-access";
import { uploadFile } from "./service";

/**
 * "Bewaar als projectkennis": a good answer becomes a project document that is included in the
 * context of every later conversation. Stored like any upload (encrypted, hashed, audited).
 */
export async function saveKnowledge(user: SessionUser, projectId: string, input: { title: string; content: string; source?: string }, meta: RequestMeta) {
  await requireProjectRole(user, projectId, "editor");
  const title = input.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Kennis";
  const date = new Date().toLocaleDateString("nl-NL");
  const body = `# ${title}\n\n_Bewaard als projectkennis op ${date}${input.source ? ` — bron: ${input.source}` : ""}._\n\n${input.content}\n`;
  return uploadFile(user, projectId, new File([body], `Kennis - ${title}.md`, { type: "text/markdown" }), meta);
}
