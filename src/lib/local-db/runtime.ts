import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSerializedReentrantWriteExecutor } from "./write-executor";

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

type SnapshotParser<T> = (valeur: unknown) => T;

let database: DatabaseSync | undefined;
let databasePath: string | undefined;

function resolveDatabasePath(): string {
  const configured = process.env.PAPOT_LOCAL_DB_PATH?.trim();
  if (configured) return path.resolve(configured);
  return path.join(process.cwd(), ".papot-dev", "papot-local.sqlite");
}

function ensureLocalSchema(cible: DatabaseSync): void {
  cible.exec(`
    CREATE TABLE IF NOT EXISTS local_business_snapshots (
      resource_key TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

function decodeJson(texte: string, errorCode: string): unknown {
  try {
    return JSON.parse(texte) as unknown;
  } catch {
    throw new Error(errorCode);
  }
}

function readSnapshotFromDatabase<T>(
  cible: DatabaseSync,
  resourceKey: string,
  parse: SnapshotParser<T>,
): LocalSnapshot<T> {
  const ligneTableau = cible
    .prepare(
      `
        SELECT version, payload_json
        FROM local_business_snapshots
        WHERE resource_key = ?
      `,
    )
    .get(resourceKey) as { version: number; payload_json: string } | undefined;

  if (!ligneTableau) return { version: 0, payload: parse(null) };
  return {
    version: ligneTableau.version,
    payload: parse(decodeJson(ligneTableau.payload_json, "LOCAL_SNAPSHOT_INVALID_JSON")),
  };
}

export function readLocalSnapshot<T>(
  resourceKey: string,
  parse: SnapshotParser<T>,
): LocalSnapshot<T> {
  return readSnapshotFromDatabase(getLocalDatabase(), resourceKey, parse);
}

function persistSnapshot<T>(
  cible: DatabaseSync,
  resourceKey: string,
  previousVersion: number,
  contenu: T,
): LocalSnapshot<T> {
  const version = previousVersion + 1;
  const updatedAt = new Date().toISOString();
  cible
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
    .run(resourceKey, version, JSON.stringify(contenu), updatedAt);
  return { version, payload: contenu };
}

const executeLocalDatabaseWrite = createSerializedReentrantWriteExecutor<DatabaseSync>({
  getTarget: getLocalDatabase,
  begin: (cible) => cible.exec("BEGIN IMMEDIATE"),
  commit: (cible) => cible.exec("COMMIT"),
  rollback: (cible) => cible.exec("ROLLBACK"),
});

export function withLocalDatabaseWrite<T>(
  work: (cible: DatabaseSync) => T | Promise<T>,
): Promise<T> {
  return executeLocalDatabaseWrite(work);
}

export async function mutateLocalSnapshot<T, R>(
  resourceKey: string,
  parse: SnapshotParser<T>,
  transform: (
    snapshot: LocalSnapshot<T>,
  ) => SnapshotMutation<T, R> | Promise<SnapshotMutation<T, R>>,
): Promise<R> {
  return withLocalDatabaseWrite(async (cible) => {
    const courant = readSnapshotFromDatabase(cible, resourceKey, parse);
    const mutation = await transform(courant);
    const parsedPayload = parse(mutation.payload);
    if (mutation.persist !== false) {
      persistSnapshot(cible, resourceKey, courant.version, parsedPayload);
    }
    return mutation.result;
  });
}

export async function replaceLocalSnapshot<T>(
  resourceKey: string,
  parse: SnapshotParser<T>,
  contenu: T,
): Promise<LocalSnapshot<T>> {
  return withLocalDatabaseWrite((cible) => {
    const courant = readSnapshotFromDatabase(cible, resourceKey, parse);
    return persistSnapshot(cible, resourceKey, courant.version, parse(contenu));
  });
}
