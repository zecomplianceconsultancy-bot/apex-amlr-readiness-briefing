import path from "node:path";
import { notFound } from "next/navigation";
import { allowedToolDomains, BROWSER_CHOICES, BROWSER_LABELS, installedBrowsers, LOGIN_PROVIDERS_LABEL } from "@/server/ai/browser/isolation";
import { siteStatuses } from "@/server/ai/browser/session";
import { listSites } from "@/server/ai/browser/sites";
import { requirePageUser } from "@/server/auth/page-guards";
import { env } from "@/server/config/env";
import { browserChoice, browserControlMode } from "@/server/settings/permissions";
import { PageHeader } from "@/components/ui";
import { BrowserTools } from "./browser-tools";

export default async function ToolsPage() {
  const user = await requirePageUser();
  if (user.role !== "admin") notFound();
  const statuses = siteStatuses();
  const installed = installedBrowsers();
  const e = env();
  const choice = browserChoice();
  return (
    <main className="mx-auto max-w-4xl p-6">
      <PageHeader
        title="Browser-tools"
        description="Optioneel: de workspace kan AI-tools bedienen in één browser die jij kiest, in een apart venster met een eigen werkprofiel. Dat staat standaard uit en gebeurt alleen met jouw toestemming. Zonder browserbesturing werk je met de handmatige route (kopiëren en plakken) of met een API."
      />
      <BrowserTools
        enabled={e.ENABLE_BROWSER_PROVIDER}
        mode={browserControlMode()}
        browser={choice}
        browsers={BROWSER_CHOICES.map((id) => ({ id, label: BROWSER_LABELS[id], installed: installed[id] }))}
        profileDir={path.relative(process.cwd(), path.join(e.BROWSER_PROFILE_DIR, choice)) || e.BROWSER_PROFILE_DIR}
        allowedDomains={allowedToolDomains()}
        loginProviders={LOGIN_PROVIDERS_LABEL}
        sites={listSites().map((s) => ({ id: s.id, label: s.label, url: s.newChatUrl, status: statuses[s.id] ?? null }))}
      />
    </main>
  );
}
