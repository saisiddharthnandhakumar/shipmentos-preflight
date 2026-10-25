import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

let pool: Pool | null = null;
let db: Db | null = null;

/**
 * Transaction-capable Drizzle client over node-postgres using Neon's pooled URL.
 * `attachDatabasePool` lets Vercel Fluid compute drain idle clients before suspending.
 * (Interactive `db.transaction()` is NOT supported by drizzle-orm/neon-http, so we don't use it.)
 */
export function getDb(): Db {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new DatabaseUnavailableError("DATABASE_URL is not configured");
  pool = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  pool.on("error", () => {
    // Idle client errors (e.g. Neon compute suspend) must not crash the process; next query reconnects.
  });
  attachDatabasePool(pool);
  db = drizzle(pool, { schema });
  return db;
}

export class DatabaseUnavailableError extends Error {
  constructor(message = "Database unavailable") {
    super(message);
    this.name = "DatabaseUnavailableError";
  }
}

/** For tests only: close the pool so Vitest can exit. */
export async function closeDb() {
  await pool?.end();
  pool = null;
  db = null;
}
