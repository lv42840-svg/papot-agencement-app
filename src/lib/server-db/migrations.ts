import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "./pool";

const MIGRATION_LOCK_ID = 7_332_170_416_238_501;
const BOOTSTRAP_VERSION = 1;
const BOOTSTRAP_NAME = "bootstrap_schema_migrations";

async function ensureMigrationRegistry(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function runServerDbMigrations(pool: Pool = getServerDbPool()): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_ID]);
    await ensureMigrationRegistry(client);
    await client.query(
      `
        INSERT INTO papot_schema_migrations (version, name)
        VALUES ($1, $2)
        ON CONFLICT (version) DO NOTHING
      `,
      [BOOTSTRAP_VERSION, BOOTSTRAP_NAME],
    );
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the migration error that triggered the rollback.
    }
    throw error;
  } finally {
    client.release();
  }
}
