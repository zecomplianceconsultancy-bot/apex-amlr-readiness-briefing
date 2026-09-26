import Link from "next/link";
import { requirePageUser } from "@/server/auth/page-guards";
import { LogoutButton } from "@/components/logout-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
        <Link href="/projects" className="flex items-center gap-2 font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-bold text-white">AI</span>
          AI Workspace
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {user.role === "admin" && (
            <Link href="/admin/audit" className="text-slate-600 hover:text-slate-900">
              Audit (admin)
            </Link>
          )}
          <span className="text-slate-500">{user.name}</span>
          <LogoutButton />
        </div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
