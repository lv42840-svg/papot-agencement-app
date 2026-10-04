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
const LIBRARY_STORAGE_VERSION = 7;
const LIBRARY_STORAGE_NAME = "library_postgres_storage";
const COMPANY_PROFILE_STORAGE_VERSION = 8;
const COMPANY_PROFILE_STORAGE_NAME = "company_profile_postgres_storage";
const QUOTES_STORAGE_VERSION = 9;
const QUOTES_STORAGE_NAME = "quotes_postgres_storage";
const PLANNING_STORAGE_VERSION = 10;
const PLANNING_STORAGE_NAME = "planning_postgres_storage";
const USER_UI_PREFERENCES_VERSION = 11;
const USER_UI_PREFERENCES_NAME = "user_ui_preferences";
const QUOTE_EMAIL_SETTINGS_VERSION = 12;
const QUOTE_EMAIL_SETTINGS_NAME = "quote_email_settings";

const FRESH_WEB_SOURCE = "fresh:web";
const FRESH_WEB_HASH = "fresh-empty-v1";
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

type ServerDbEnv = Record<string, string | undefined>;

function freshWebBootstrapEnabled(env: ServerDbEnv): boolean {
  return (env.PAPOT_POSTGRES_BOOTSTRAP_MODE ?? "").trim().toLowerCase() === "fresh";
}

async function ensureFreshWebBootstrap(client: PoolClient): Promise<void> {
  const counts = await client.query<{
    clients: string;
    auth_users: string;
    auth_sessions: string;
    entries: string;
    commercial: string;
    chantiers: string;
    library: string;
    quotes: string;
    cutovers: string;
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM papot_clients) AS clients,
      (SELECT COUNT(*)::text FROM papot_auth_users) AS auth_users,
      (SELECT COUNT(*)::text FROM papot_auth_sessions) AS auth_sessions,
      (SELECT COUNT(*)::text FROM papot_entries_state) AS entries,
      (SELECT COUNT(*)::text FROM papot_commercial_state) AS commercial,
      (SELECT COUNT(*)::text FROM papot_chantiers_state) AS chantiers,
      (SELECT COUNT(*)::text FROM papot_library_state) AS library,
      (SELECT COUNT(*)::text FROM papot_quotes_state) AS quotes,
      (SELECT COUNT(*)::text FROM papot_domain_cutovers) AS cutovers
  `);

  const row = counts.rows[0];
  if (!row) throw new Error("PAPOT_FRESH_BOOTSTRAP_STATE_UNAVAILABLE");

  const businessCounts = [
    row.clients,
    row.auth_users,
    row.auth_sessions,
    row.entries,
    row.commercial,
    row.chantiers,
    row.library,
    row.quotes,
  ];

  const allBusinessEmpty = businessCounts.every((count) => count === "0");
  const alreadyBootstrapped = row.cutovers === "9";

  if (alreadyBootstrapped) return;
  if (!allBusinessEmpty || row.cutovers !== "0") {
    throw new Error("PAPOT_FRESH_BOOTSTRAP_REQUIRES_EMPTY_DATABASE");
  }

  await client.query(
    `
      INSERT INTO papot_entries_state (scope, version, payload)
      VALUES (
        'global',
        1,
        $1::jsonb
      )
    `,
    [
      JSON.stringify({
        schemaVersion: 1,
        tags: [
          { id: "contact", label: "Contact", active: true, sortOrder: 0 },
          { id: "devis", label: "Devis", active: true, sortOrder: 1 },
          { id: "chiffrage-seul", label: "Chiffrage seul", active: true, sortOrder: 2 },
          { id: "sav", label: "SAV", active: true, sortOrder: 3 },
          {
            id: "intervention-chantier",
            label: "Intervention chantier",
            active: true,
            sortOrder: 4,
          },
          {
            id: "compte-rendu-chantier",
            label: "Compte rendu de chantier",
            active: true,
            sortOrder: 5,
          },
        ],
        entries: [],
        notifications: [],
      }),
    ],
  );

  await client.query(
    `
      INSERT INTO papot_commercial_state (scope, version, payload)
      VALUES ('global', 1, '{"schemaVersion":2,"clients":[],"cases":[]}'::jsonb)
    `,
  );

  await client.query(
    `
      INSERT INTO papot_chantiers_state (scope, version, payload)
      VALUES ('global', 1, '{"schemaVersion":1,"chantiers":[]}'::jsonb)
    `,
  );

  await client.query(
    `
      INSERT INTO papot_library_state (
        scope,
        version,
        payload,
        updated_by_user_id,
        updated_by_device_id
      )
      VALUES (
        'catalog',
        0,
        '{"schemaVersion":1,"components":[],"ouvrages":[]}'::jsonb,
        $1,
        $1
      )
    `,
    [EMPTY_UUID],
  );

  await client.query(
    `
      INSERT INTO papot_quotes_state (scope, version, payload)
      VALUES ('global', 1, '{"schemaVersion":1,"quotes":[]}'::jsonb)
    `,
  );

  for (const domain of [
    "clients",
    "auth",
    "entries",
    "commercial",
    "chantiers",
    "library",
    "quotes",
    "commercial_document_files",
    "entry_attachment_files",
  ]) {
    await client.query(
      `
        INSERT INTO papot_domain_cutovers (
          domain,
          source,
          source_hash,
          record_count
        )
        VALUES ($1, $2, $3, 0)
      `,
      [domain, FRESH_WEB_SOURCE, FRESH_WEB_HASH],
    );
  }
}

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

async function ensureUserUiPreferences(client: PoolClient): Promise<void> {
  await client.query(`
    ALTER TABLE papot_auth_users
    ADD COLUMN IF NOT EXISTS planning_potential_collapsed BOOLEAN NOT NULL DEFAULT FALSE
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

async function ensureLibraryStorage(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_library_state (
      scope TEXT PRIMARY KEY CHECK (scope = 'catalog'),
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
      payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by_user_id UUID NOT NULL,
      updated_by_device_id UUID NOT NULL
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_library_edit_lock (
      scope TEXT PRIMARY KEY CHECK (scope = 'catalog'),
      lock_data JSONB NOT NULL CHECK (jsonb_typeof(lock_data) = 'object')
    )
  `);
}

async function ensureQuotesStorage(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_quotes_state (
      scope TEXT PRIMARY KEY CHECK (scope = 'global'),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensurePlanningStorage(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_planning_state (
      scope TEXT PRIMARY KEY CHECK (scope = 'global'),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    INSERT INTO papot_planning_state (scope, version, payload)
    VALUES (
      'global',
      1,
      '{"schemaVersion":1,"macroAllocations":[],"chantierOrder":[]}'::jsonb
    )
    ON CONFLICT (scope) DO NOTHING
  `);
}

async function ensureQuoteEmailSettingsStorage(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_quote_email_settings (
      scope TEXT PRIMARY KEY CHECK (scope = 'global'),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    INSERT INTO papot_quote_email_settings (scope, version, payload)
    VALUES (
      'global',
      1,
      $1::jsonb
    )
    ON CONFLICT (scope) DO NOTHING
  `, [
    JSON.stringify({
      fromEmail: "noreply@papot.eu",
      ccEmail: "contact@papot.eu",
      replyToEmail: "contact@papot.eu",
      subjectTemplate: "Devis {{NUM_DEVIS}} - {{AFFAIRE}}",
      bodyTemplate:
        "{{BONJOUR}}\n\nVeuillez trouver ci-joint notre devis {{NUM_DEVIS}} concernant {{OBJET_DEVIS}}.\n\nBien cordialement,\nPAPOT AGENCEMENT",
    }),
  ]);
}

async function ensureCompanyProfileStorage(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS papot_company_profile (
      scope TEXT PRIMARY KEY CHECK (scope = 'global'),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    INSERT INTO papot_company_profile (scope, version, payload)
    VALUES ('global', 1, '{}'::jsonb)
    ON CONFLICT (scope) DO NOTHING
  `);
}

export async function runServerDbMigrations(
  pool: Pool = getServerDbPool(),
  env: ServerDbEnv = process.env,
): Promise<void> {
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

    await ensureLibraryStorage(client);
    await client.query(
      `
        INSERT INTO papot_schema_migrations (version, name)
        VALUES ($1, $2)
        ON CONFLICT (version) DO NOTHING
      `,
      [LIBRARY_STORAGE_VERSION, LIBRARY_STORAGE_NAME],
    );

    await ensureCompanyProfileStorage(client);
    await client.query(
      `
        INSERT INTO papot_schema_migrations (version, name)
        VALUES ($1, $2)
        ON CONFLICT (version) DO NOTHING
      `,
      [COMPANY_PROFILE_STORAGE_VERSION, COMPANY_PROFILE_STORAGE_NAME],
    );

    await ensureQuotesStorage(client);
    await client.query(
      `
        INSERT INTO papot_schema_migrations (version, name)
        VALUES ($1, $2)
        ON CONFLICT (version) DO NOTHING
      `,
      [QUOTES_STORAGE_VERSION, QUOTES_STORAGE_NAME],
    );

    await ensurePlanningStorage(client);
    await client.query(
      `
        INSERT INTO papot_schema_migrations (version, name)
        VALUES ($1, $2)
        ON CONFLICT (version) DO NOTHING
      `,
      [PLANNING_STORAGE_VERSION, PLANNING_STORAGE_NAME],
    );

    await ensureUserUiPreferences(client);
    await client.query(
      `
        INSERT INTO papot_schema_migrations (version, name)
        VALUES ($1, $2)
        ON CONFLICT (version) DO NOTHING
      `,
      [USER_UI_PREFERENCES_VERSION, USER_UI_PREFERENCES_NAME],
    );

    await ensureQuoteEmailSettingsStorage(client);
    await client.query(
      `
        INSERT INTO papot_schema_migrations (version, name)
        VALUES ($1, $2)
        ON CONFLICT (version) DO NOTHING
      `,
      [QUOTE_EMAIL_SETTINGS_VERSION, QUOTE_EMAIL_SETTINGS_NAME],
    );

    if (freshWebBootstrapEnabled(env)) {
      await ensureFreshWebBootstrap(client);
    }

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
