import Link from "next/link";
import { requirePageUser } from "@/server/auth/page-guards";
import { listProjectsForUser } from "@/server/projects/service";
import { ClassificationBadge, PageHeader } from "@/components/ui";
import { ROLE_LABELS, formatDateTime } from "@/lib/format";
import { CreateProjectForm } from "./create-project-form";

export default async function ProjectsPage() {
  const user = await requirePageUser();
  const projects = await listProjectsForUser(user.id);
  return (
    <main className="mx-auto max-w-5xl p-6">
      <PageHeader title="Projecten" description="Elk project is een afgeschermde werkruimte met eigen context, bestanden, gesprekken en audit trail." />
      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {projects.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              Nog geen projecten. Maak rechts je eerste project aan.
            </p>
          )}
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-300">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-medium">{p.name}</h2>
                <ClassificationBadge value={p.classification} />
              </div>
              {p.description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{p.description}</p>}
              <p className="mt-2 text-xs text-slate-400">
                {ROLE_LABELS[p.role]} · bijgewerkt {formatDateTime(p.updatedAt)}
              </p>
            </Link>
          ))}
        </div>
        <CreateProjectForm />
      </div>
    </main>
  );
}
