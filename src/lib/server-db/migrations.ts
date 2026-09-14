import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "./pool";

const MIGRATION_LOCK_ID = 7_332_170_416_238_501;
const BOOTSTRAP_VERSION = 1;
const BOOTSTRAP_NAME = "bootstrap_schema_migrations";
const CLIENTS_STORAGE_VERSION = 2;
const CLIENTS_STORAGE_NAME = "clients_postgres_storage";
const AUTH_STORAGE_VERSION = 3;
const AUTH_STORAGE_NAME = "auth_postgres_storage";
const ENTRIES_STORAGE_VERSION = 4;
const ENTRIES_STORAGE_NAME = "entries_postgres_storage";
const COMMERCIAL_STORAGE_VERSION = 5;
const COMMERCIAL_STORAGE_NAME = "commercial_postgres_storage";
const CHANTIERS_STORAGE_VERSION = 6;
const CHANTIERS_STORAGE_NAME = "chantiers_postgres_storage";

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

async function ensureAuthStorage(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_auth_users (
      id UUID PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      display_name TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_active BOOLEAN NOT NULL,
      can_manage_permissions BOOLEAN NOT NULL,
      must_change_password BOOLEAN NOT NULL,
      accent_key TEXT NOT NULL,
      module_permissions JSONB NOT NULL CHECK (jsonb_typeof(module_permissions) = 'object'),
      special_permissions JSONB NOT NULL CHECK (jsonb_typeof(special_permissions) = 'array')
    )
  `);

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS papot_auth_users_email_unique
    ON papot_auth_users (LOWER(email))
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_auth_sessions (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES papot_auth_users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      device_id UUID,
      device_label TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS papot_auth_sessions_user_id_index
    ON papot_auth_sessions (user_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS papot_auth_sessions_expires_at_index
    ON papot_auth_sessions (expires_at)
  `);
}

async function ensureEntriesStorage(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_entries_state (
      scope TEXT PRIMARY KEY CHECK (scope = 'global'),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureCommercialStorage(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_commercial_state (
      scope TEXT PRIMARY KEY CHECK (scope = 'global'),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureChantiersStorage(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_chantiers_state (
      scope TEXT PRIMARY KEY CHECK (scope = 'global'),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

    await ensureAuthStorage(client);
    await client.query(
      `
        INSERT INTO papot_schema_migrations (version, name)
        VALUES ($1, $2)
        ON CONFLICT (version) DO NOTHING
      `,
      [AUTH_STORAGE_VERSION, AUTH_STORAGE_NAME],
    );

    await ensureEntriesStorage(client);
    await client.query(
      `
        INSERT INTO papot_schema_migrations (version, name)
        VALUES ($1, $2)
        ON CONFLICT (version) DO NOTHING
      `,
      [ENTRIES_STORAGE_VERSION, ENTRIES_STORAGE_NAME],
    );

    await ensureCommercialStorage(client);
    await client.query(
      `
        INSERT INTO papot_schema_migrations (version, name)
        VALUES ($1, $2)
        ON CONFLICT (version) DO NOTHING
      `,
      [COMMERCIAL_STORAGE_VERSION, COMMERCIAL_STORAGE_NAME],
    );

    await ensureChantiersStorage(client);
    await client.query(
      `
        INSERT INTO papot_schema_migrations (version, name)
        VALUES ($1, $2)
        ON CONFLICT (version) DO NOTHING
      `,
      [CHANTIERS_STORAGE_VERSION, CHANTIERS_STORAGE_NAME],
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
