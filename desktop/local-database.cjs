"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DATABASE_FILE_NAME = "papot-local.sqlite";
const LOCAL_DATABASE_SCHEMA_VERSION = 2;
const FORBIDDEN_SETTING_KEY = /(password|secret|token|credential|private[_-]?key)/i;

function databasePath(userDataPath) {
  return path.join(userDataPath, DATABASE_FILE_NAME);
}

function migrate(database) {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS local_schema (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        version INTEGER NOT NULL
      ) STRICT;

      INSERT OR IGNORE INTO local_schema (singleton, version) VALUES (1, 0);
    `);

    const current = database.prepare("SELECT version FROM local_schema WHERE singleton = 1").get();
    if (current.version > LOCAL_DATABASE_SCHEMA_VERSION) {
      throw new Error("LOCAL_DATABASE_SCHEMA_TOO_NEW");
    }

    if (current.version < 1) {
      database.exec(`
        CREATE TABLE local_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE cache_entries (
          namespace TEXT NOT NULL,
          cache_key TEXT NOT NULL,
          value_json TEXT NOT NULL,
          source_etag TEXT,
          expires_at TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (namespace, cache_key)
        ) STRICT;

        CREATE TABLE pending_operations (
          operation_id TEXT PRIMARY KEY,
          operation_kind TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'FAILED')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          next_attempt_at TEXT,
          last_error_code TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX pending_operations_ready_idx
          ON pending_operations (status, next_attempt_at, created_at);

        UPDATE local_schema SET version = 1 WHERE singleton = 1;
      `);
    }

    if (current.version < 2) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS local_business_snapshots (
          resource_key TEXT PRIMARY KEY,
          version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
          payload_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS local_shared_resource_states (
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          envelope_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (resource_type, resource_id)
        ) STRICT;

        CREATE TABLE IF NOT EXISTS local_shared_resource_locks (
          resource_type TEXT NOT NULL,
          resource_id TEXT NOT NULL,
          lock_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (resource_type, resource_id)
        ) STRICT;

        UPDATE local_schema SET version = 2 WHERE singleton = 1;
      `);
    }

    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function openLocalDatabase(userDataPath) {
  const database = new DatabaseSync(databasePath(userDataPath));
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  migrate(database);
  return database;
}

function setLocalSetting(database, key, value) {
  if (typeof key !== "string" || !key.trim()) throw new Error("LOCAL_SETTING_KEY_REQUIRED");
  if (FORBIDDEN_SETTING_KEY.test(key)) throw new Error("LOCAL_SETTING_SECRET_FORBIDDEN");

  database
    .prepare(
      `
      INSERT INTO local_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `,
    )
    .run(key.trim(), JSON.stringify(value), new Date().toISOString());
}

function getLocalSetting(database, key) {
  const row = database.prepare("SELECT value_json FROM local_settings WHERE key = ?").get(key);
  return row ? JSON.parse(row.value_json) : null;
}

module.exports = {
  DATABASE_FILE_NAME,
  LOCAL_DATABASE_SCHEMA_VERSION,
  databasePath,
  getLocalSetting,
  openLocalDatabase,
  setLocalSetting,
};
