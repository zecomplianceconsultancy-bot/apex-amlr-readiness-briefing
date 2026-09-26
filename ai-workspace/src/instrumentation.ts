/** Runs once when the server starts: open the database and apply migrations. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initDb } = await import("@/server/db/client");
    await initDb();
  }
}
