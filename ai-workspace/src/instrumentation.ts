/** Runs once when the server starts: open the database, apply migrations, close cleanly on exit. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initDb, closeDb } = await import("@/server/db/client");
    await initDb();
    const { loadPermissions } = await import("@/server/settings/permissions");
    await loadPermissions();
    const { API_PROVIDERS, loadApiSettings } = await import("@/server/settings/api-keys");
    await loadApiSettings();
    const { apiSpendThisMonth } = await import("@/server/usage/api-spend");
    await Promise.all(API_PROVIDERS.map((p) => apiSpendThisMonth(p).catch(() => 0)));
    let closing = false;
    const shutdown = async (signal: string) => {
      if (closing) return;
      closing = true;
      console.log(`[aiw] ${signal}: database netjes afsluiten…`);
      await closeDb().catch(() => undefined);
      process.exit(0);
    };
    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));
  }
}
