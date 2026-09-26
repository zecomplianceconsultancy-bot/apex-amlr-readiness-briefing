import { redirect } from "next/navigation";
import { needsSetup } from "@/server/auth/setup";
import { SetupForm } from "./setup-form";

export default async function SetupPage() {
  if (!(await needsSetup())) redirect("/login");
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">AI</div>
          <h1 className="text-xl font-semibold">Welkom bij AI Workspace</h1>
          <p className="mt-1 text-sm text-slate-500">Maak je beheerdersaccount aan. Alles blijft op deze computer.</p>
        </div>
        <SetupForm />
      </div>
    </main>
  );
}
