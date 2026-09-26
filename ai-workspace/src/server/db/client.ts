import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/server/config/env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle has the same query API as the database. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { __aiWorkspacePool?: Pool; __aiWorkspaceDb?: Database };

export function db(): Database {
  if (!globalForDb.__aiWorkspaceDb) {
    const pool = globalForDb.__aiWorkspacePool ?? new Pool({ connectionString: env().DATABASE_URL, max: 10 });
    globalForDb.__aiWorkspacePool = pool;
    globalForDb.__aiWorkspaceDb = drizzle(pool, { schema });
  }
  return globalForDb.__aiWorkspaceDb;
}

export { schema };
