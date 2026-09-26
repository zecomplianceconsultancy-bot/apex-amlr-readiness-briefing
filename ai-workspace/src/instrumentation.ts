/** Runs once when the server starts: open the database, apply migrations, close cleanly on exit. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initDb, closeDb } = await import("@/server/db/client");
    await initDb();
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
