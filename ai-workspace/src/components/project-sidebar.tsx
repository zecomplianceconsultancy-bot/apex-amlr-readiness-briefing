"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClassificationBadge } from "./ui";
import { NewConversationButton } from "./new-conversation-button";

interface Props {
  project: { id: string; name: string; classification: string; piiRedaction: boolean };
  role: "owner" | "editor" | "viewer";
  conversations: { id: string; title: string }[];
}

export function ProjectSidebar({ project, role, conversations }: Props) {
  const pathname = usePathname();
  const base = `/projects/${project.id}`;
  const nav = [
    { href: `${base}/context`, label: "Projectcontext" },
    { href: `${base}/files`, label: "Bestanden" },
    { href: `${base}/sources`, label: "Bronnen" },
    { href: `${base}/settings`, label: "Instellingen" },
    ...(role === "owner" ? [{ href: `${base}/audit`, label: "Audit trail" }] : []),
  ];
  const linkClass = (active: boolean) =>
    `block truncate rounded-md px-2 py-1.5 text-sm ${active ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-700 hover:bg-slate-100"}`;

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-3">
        <Link href="/projects" className="text-xs text-slate-500 hover:text-slate-700">
          ← Alle projecten
        </Link>
        <h2 className="mt-1 truncate font-semibold" title={project.name}>
          {project.name}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <ClassificationBadge value={project.classification} />
          {project.piiRedaction && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">PII-masking aan</span>}
        </div>
      </div>
      <nav className="space-y-0.5 border-b border-slate-200 p-2">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className={linkClass(pathname === n.href)}>
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="flex min-h-0 flex-1 flex-col p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Gesprekken</span>
        </div>
        {role !== "viewer" && <NewConversationButton projectId={project.id} className="mb-2 w-full" />}
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {conversations.map((c) => (
            <Link key={c.id} href={`${base}/c/${c.id}`} className={linkClass(pathname === `${base}/c/${c.id}`)} title={c.title}>
              {c.title}
            </Link>
          ))}
          {conversations.length === 0 && <p className="px-2 text-xs text-slate-400">Nog geen gesprekken.</p>}
        </div>
      </div>
    </aside>
  );
}
