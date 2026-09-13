"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { Client } = require("pg");

const MIGRATION_LOCK_KEY = "papot-agencement-schema-migrations";

function desktopMigrationsDirectory({ isPackaged, resourcesPath, projectRoot }) {
  return isPackaged
    ? path.join(resourcesPath, "db", "migrations")
    : path.join(projectRoot, "db", "migrations");
}

async function runDatabaseMigrations({ connectionString, migrationsDirectory }) {
  if (typeof connectionString !== "string" || !connectionString.trim()) {
    throw new Error("DESKTOP_DATABASE_URL_REQUIRED");
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 60_000,
  });

  try {
    await client.connect();
    await client.query("SELECT pg_advisory_lock(hashtext($1)::bigint)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        filename text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await fs.readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      const exists = await client.query(
        "SELECT 1 FROM schema_migration WHERE filename = $1",
        [filename],
      );
      if (exists.rowCount) continue;

      const sql = await fs.readFile(path.join(migrationsDirectory, filename), "utf8");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migration(filename) VALUES ($1) ON CONFLICT DO NOTHING",
        [filename],
      );
      console.info(`[PAPOT][Database] migration applied: ${filename}`);
    }
  } finally {
    if (client._connected) {
      await client
        .query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [MIGRATION_LOCK_KEY])
        .catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}

module.exports = {
  desktopMigrationsDirectory,
  runDatabaseMigrations,
};
