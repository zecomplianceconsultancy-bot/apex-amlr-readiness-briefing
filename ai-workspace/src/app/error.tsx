"use client";

/** Friendly fallback for unexpected errors; the details are in the server log. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold">Er ging iets mis</h1>
        <p className="mt-2 text-sm text-slate-500">
          Je gegevens zijn veilig. Probeer het opnieuw; blijft het misgaan, herstart dan de workspace (sluit het zwarte venster en dubbelklik opnieuw op het
          startbestand).
        </p>
        {error.digest && <p className="mt-2 font-mono text-xs text-slate-400">Foutcode: {error.digest}</p>}
        <div className="mt-4 flex justify-center gap-2">
          <button onClick={reset} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">
            Opnieuw proberen
          </button>
          <a href="/projects" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300">
            Naar projecten
          </a>
        </div>
      </div>
    </main>
  );
}
