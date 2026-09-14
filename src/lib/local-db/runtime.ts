import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export { isLocalStorageMode } from "./mode";

export type LocalSnapshot<T> = {
  version: number;
  payload: T;
};

type SnapshotMutation<T, R> = {
  payload: T;
  result: R;
  persist?: boolean;
};

type SnapshotParser<T> = (value: unknown) => T;

let database: DatabaseSync | undefined;
let databasePath: string | undefined;
let writeQueue: Promise<void> = Promise.resolve();

function resolveDatabasePath(): string {
  const configured = process.env.PAPOT_LOCAL_DB_PATH?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), ".papot-dev", "papot-local.sqlite");
}

function ensureLocalSchema(target: DatabaseSync): void {
  target.exec(`
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
  `);
}

export function getLocalDatabase(): DatabaseSync {
  const nextPath = resolveDatabasePath();
  if (database && databasePath === nextPath) return database;

  if (database) database.close();
  fs.mkdirSync(path.dirname(nextPath), { recursive: true });

  database = new DatabaseSync(nextPath);
  databasePath = nextPath;
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  ensureLocalSchema(database);
  return database;
}

function decodeJson(text: string, errorCode: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(errorCode);
  }
}

function readSnapshotFromDatabase<T>(
  target: DatabaseSync,
  resourceKey: string,
  parse: SnapshotParser<T>,
): LocalSnapshot<T> {
  const row = target
    .prepare(
      `
        SELECT version, payload_json
        FROM local_business_snapshots
        WHERE resource_key = ?
      `,
    )
    .get(resourceKey) as { version: number; payload_json: string } | undefined;

  if (!row) return { version: 0, payload: parse(null) };
  return {
    version: row.version,
    payload: parse(decodeJson(row.payload_json, "LOCAL_SNAPSHOT_INVALID_JSON")),
  };
}

export function readLocalSnapshot<T>(
  resourceKey: string,
  parse: SnapshotParser<T>,
): LocalSnapshot<T> {
  return readSnapshotFromDatabase(getLocalDatabase(), resourceKey, parse);
}

function persistSnapshot<T>(
  target: DatabaseSync,
  resourceKey: string,
  previousVersion: number,
  payload: T,
): LocalSnapshot<T> {
  const version = previousVersion + 1;
  const updatedAt = new Date().toISOString();
  target
    .prepare(
      `
        INSERT INTO local_business_snapshots (resource_key, version, payload_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(resource_key) DO UPDATE SET
          version = excluded.version,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `,
    )
    .run(resourceKey, version, JSON.stringify(payload), updatedAt);
  return { version, payload };
}

export function withLocalDatabaseWrite<T>(
  work: (target: DatabaseSync) => T | Promise<T>,
): Promise<T> {
  const run = async () => {
    const target = getLocalDatabase();
    target.exec("BEGIN IMMEDIATE");
    try {
      const result = await work(target);
      target.exec("COMMIT");
      return result;
    } catch (error) {
      target.exec("ROLLBACK");
      throw error;
    }
  };

  const result = writeQueue.then(run, run);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function mutateLocalSnapshot<T, R>(
  resourceKey: string,
  parse: SnapshotParser<T>,
  transform: (
    snapshot: LocalSnapshot<T>,
  ) => SnapshotMutation<T, R> | Promise<SnapshotMutation<T, R>>,
): Promise<R> {
  return withLocalDatabaseWrite(async (target) => {
    const current = readSnapshotFromDatabase(target, resourceKey, parse);
    const mutation = await transform(current);
    const parsedPayload = parse(mutation.payload);
    if (mutation.persist !== false) {
      persistSnapshot(target, resourceKey, current.version, parsedPayload);
    }
    return mutation.result;
  });
}

export async function replaceLocalSnapshot<T>(
  resourceKey: string,
  parse: SnapshotParser<T>,
  payload: T,
): Promise<LocalSnapshot<T>> {
  return withLocalDatabaseWrite((target) => {
    const current = readSnapshotFromDatabase(target, resourceKey, parse);
    return persistSnapshot(target, resourceKey, current.version, parse(payload));
  });
}
