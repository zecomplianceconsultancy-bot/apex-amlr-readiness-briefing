import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { env } from "@/server/config/env";
import * as schema from "./schema";

/**
 * Two interchangeable drivers behind one Drizzle API:
 *  - desktop mode (no DATABASE_URL): PGlite, a full PostgreSQL embedded in the app process,
 *    stored in DATA_DIR/db. Nothing to install.
 *  - server mode (DATABASE_URL set): node-postgres against a PostgreSQL server.
 * Same schema, same migrations, same triggers.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
/** A transaction handle has the same query API as the database. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

interface DbState {
  db?: Database;
  migrated?: Promise<void>;
  close?: () => Promise<void>;
}
// Reuse one connection across hot reloads in development.
const g = globalThis as unknown as { __aiWorkspaceDb?: DbState };
const state: DbState = (g.__aiWorkspaceDb ??= {});

const MIGRATIONS = path.resolve(process.cwd(), "drizzle");

async function open(): Promise<void> {
  const e = env();
  if (e.DATABASE_URL) {
    const [{ Pool }, { drizzle }, { migrate }] = await Promise.all([
      import("pg"),
      import("drizzle-orm/node-postgres"),
      import("drizzle-orm/node-postgres/migrator"),
    ]);
    const pool = new Pool({ connectionString: e.DATABASE_URL, max: 10 });
    const d = drizzle(pool, { schema });
    await migrate(d, { migrationsFolder: MIGRATIONS });
    state.db = d as unknown as Database;
    state.close = () => pool.end();
  } else {
    const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
      import("@electric-sql/pglite"),
      import("drizzle-orm/pglite"),
      import("drizzle-orm/pglite/migrator"),
    ]);
    const dir = path.join(e.DATA_DIR, "db");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const client = new PGlite(dir);
    const d = drizzle(client, { schema });
    await migrate(d, { migrationsFolder: MIGRATIONS });
    state.db = d as unknown as Database;
    state.close = () => client.close();
  }
}

/** Opens the database and applies pending migrations (idempotent, safe to call often). */
export function initDb(): Promise<void> {
  state.migrated ??= open().catch((err) => {
    state.migrated = undefined;
    throw err;
  });
  return state.migrated;
}

/** The database handle. `initDb()` must have completed (done at startup, see instrumentation.ts). */
export function db(): Database {
  if (!state.db) throw new Error("Database not initialised: call initDb() first");
  return state.db;
}

export async function closeDb(): Promise<void> {
  await state.close?.();
  state.db = undefined;
  state.migrated = undefined;
  state.close = undefined;
}

export { schema };
