"use client";

import { useEffect } from "react";

/** Code of a previous version (or of another app that used this address) that the browser still holds. */
const isStaleCode = (e: Error) =>
  e.name === "ChunkLoadError" || /Loading (CSS )?chunk|Failed to load chunk|dynamically imported module|Failed to fetch/i.test(e.message ?? "");

/** Friendly fallback for unexpected errors; server details are in data/logs. */
export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    // After an update the browser may still run the old version: load the page fresh, once.
    if (!isStaleCode(error)) return;
    try {
      // At most once a minute, so a real problem cannot cause a reload loop.
      if (Date.now() - Number(sessionStorage.getItem("aiw-reloaded") ?? 0) < 60_000) return;
      sessionStorage.setItem("aiw-reloaded", String(Date.now()));
    } catch {
      return;
    }
    window.location.reload();
  }, [error]);

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Er ging iets mis</h1>
        <p className="mt-2 text-sm text-slate-500">
          Je gegevens zijn veilig. Klik op <b>Pagina vernieuwen</b>. Blijft het misgaan, sluit dan dit tabblad, herstart de workspace (sluit het zwarte venster en
          start opnieuw) en open het adres dat in het zwarte venster staat.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={() => window.location.reload()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">
            Pagina vernieuwen
          </button>
          <a href="/projects" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300">
            Naar projecten
          </a>
        </div>
        <details className="mt-4 text-left text-xs text-slate-500">
          <summary className="cursor-pointer text-center">Technische details (om door te sturen)</summary>
          <p className="mt-2 break-all font-mono">
            {error.digest ? `Foutcode: ${error.digest} (details in data/logs)` : `${error.name}: ${error.message}`}
          </p>
        </details>
      </div>
    </main>
  );
}
