/** Apply migrations (embedded DB in DATA_DIR, or DATABASE_URL). The app also does this on start. */
import "dotenv/config";
import { closeDb, initDb } from "@/server/db/client";

await initDb();
await closeDb();
console.log("Migrations applied.");
