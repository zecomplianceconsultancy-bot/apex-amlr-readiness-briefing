import { notFound } from "next/navigation";
import { siteStatuses } from "@/server/ai/browser/session";
import { listSites } from "@/server/ai/browser/sites";
import { requirePageUser } from "@/server/auth/page-guards";
import { env } from "@/server/config/env";
import { PageHeader } from "@/components/ui";
import { BrowserTools } from "./browser-tools";

export default async function ToolsPage() {
  const user = await requirePageUser();
  if (user.role !== "admin") notFound();
  const statuses = siteStatuses();
  return (
    <main className="mx-auto max-w-4xl p-6">
      <PageHeader
        title="Browser-tools"
        description="De workspace bedient deze AI-tools via hun gewone webinterface in een browservenster op deze computer. Log per tool één keer handmatig in; daarna kun je ze in elk project als model kiezen."
      />
      <BrowserTools
        enabled={env().ENABLE_BROWSER_PROVIDER}
        sites={listSites().map((s) => ({ id: s.id, label: s.label, url: s.newChatUrl, status: statuses[s.id] ?? null }))}
      />
    </main>
  );
}
