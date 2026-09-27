import { notFound } from "next/navigation";
import { requirePageUser } from "@/server/auth/page-guards";
import { API_PROVIDERS, API_PROVIDER_INFO, apiKeyStatus, monthlyBudget } from "@/server/settings/api-keys";
import { apiSpendThisMonth } from "@/server/usage/api-spend";
import { PageHeader } from "@/components/ui";
import { ApiConnections } from "./api-connections";

export default async function ApiSettingsPage() {
  const user = await requirePageUser();
  if (user.role !== "admin") notFound();
  const providers = await Promise.all(
    API_PROVIDERS.map(async (id) => ({
      id,
      label: API_PROVIDER_INFO[id].label,
      keyPrefix: API_PROVIDER_INFO[id].keyPrefix,
      status: apiKeyStatus(id),
      budgetUsd: monthlyBudget(id),
      spentUsd: await apiSpendThisMonth(id),
    })),
  );
  return (
    <main className="mx-auto max-w-4xl p-6">
      <PageHeader
        title="API-koppelingen"
        description="Koppel Claude en Perplexity rechtstreeks: vragen gaan dan automatisch, zonder kopiëren en plakken. Je betaalt per vraag, en de workspace stopt vanzelf bij het maandbudget dat je hier instelt."
      />
      <ApiConnections providers={providers} />
    </main>
  );
}
