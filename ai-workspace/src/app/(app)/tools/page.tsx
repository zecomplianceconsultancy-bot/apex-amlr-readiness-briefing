import { notFound } from "next/navigation";
import { siteStatuses } from "@/server/ai/browser/session";
import { listSites } from "@/server/ai/browser/sites";
import { requirePageUser } from "@/server/auth/page-guards";
import { env } from "@/server/config/env";
import { browserControlMode } from "@/server/settings/permissions";
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
        description="Optioneel: de workspace kan AI-tools bedienen in een apart Chrome-venster. Dat staat standaard uit en gebeurt alleen met jouw toestemming. Zonder browserbesturing werk je met de handmatige route (kopiëren en plakken) of met een API."
      />
      <BrowserTools
        enabled={env().ENABLE_BROWSER_PROVIDER}
        mode={browserControlMode()}
        sites={listSites().map((s) => ({ id: s.id, label: s.label, url: s.newChatUrl, status: statuses[s.id] ?? null }))}
      />
    </main>
  );
}
