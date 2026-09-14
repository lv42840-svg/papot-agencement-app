import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "./pool";

const MIGRATION_LOCK_ID = 7_332_170_416_238_501;
const BOOTSTRAP_VERSION = 1;
const BOOTSTRAP_NAME = "bootstrap_schema_migrations";
const CLIENTS_STORAGE_VERSION = 2;
const CLIENTS_STORAGE_NAME = "clients_postgres_storage";

async function ensureMigrationRegistry(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureClientsStorage(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_clients (
      id UUID PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      siret TEXT,
      sort_order BIGINT NOT NULL,
      record JSONB NOT NULL CHECK (jsonb_typeof(record) = 'object'),
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS papot_clients_siret_unique
    ON papot_clients (siret)
    WHERE siret IS NOT NULL
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_domain_cutovers (
      domain TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      record_count INTEGER NOT NULL CHECK (record_count >= 0),
      cutover_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

    await ensureClientsStorage(client);
    await client.query(
      `
        INSERT INTO papot_schema_migrations (version, name)
        VALUES ($1, $2)
        ON CONFLICT (version) DO NOTHING
      `,
      [CLIENTS_STORAGE_VERSION, CLIENTS_STORAGE_NAME],
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
