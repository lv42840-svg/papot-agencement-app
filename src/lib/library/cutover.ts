import "server-only";

import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import { parseLibraryPayload, type LibraryPayload } from "./storage";

const LIBRARY_CUTOVER_DOMAIN = "library";
const LIBRARY_CUTOVER_SOURCE = "nextcloud:LIBRARY/catalog";
const LIBRARY_CUTOVER_LOCK_ID = 7_332_170_416_238_511;

type CutoverMarkerRow = {
  source_hash: string;
  record_count: number;
};

export type LockedLibrarySnapshot = {
  version: number;
  payload: LibraryPayload;
  updatedAt: string;
  updatedByUserId: string;
  updatedByDeviceId: string;
  release(): Promise<void>;
};

type ImportedLibrarySnapshot = Omit<LockedLibrarySnapshot, "release">;

export function librarySnapshotHash(snapshot: {
  version: number;
  payload: LibraryPayload;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: snapshot.version,
        payload: parseLibraryPayload(snapshot.payload),
      }),
    )
    .digest("hex");
}

async function findCutoverMarker(
  queryable: Pick<Pool, "query"> | Pick<PoolClient, "query">,
): Promise<CutoverMarkerRow | null> {
  const result = await queryable.query<CutoverMarkerRow>(
    `
      SELECT source_hash, record_count
      FROM papot_domain_cutovers
      WHERE domain = $1
    `,
    [LIBRARY_CUTOVER_DOMAIN],
  );
  return result.rows[0] ?? null;
}

function recordCount(payload: LibraryPayload): number {
  return payload.components.length + payload.ouvrages.length;
}

async function validateImportedSnapshot(client: PoolClient, expectedHash: string): Promise<void> {
  const result = await client.query<{
    version: number;
    payload: unknown;
  }>("SELECT version, payload FROM papot_library_state WHERE scope = 'catalog'");
  const row = result.rows[0];
  if (!row) throw new Error("LIBRARY_CUTOVER_VALIDATION_FAILED");

  const importedHash = librarySnapshotHash({
    version: row.version,
    payload: parseLibraryPayload(row.payload),
  });
  if (importedHash !== expectedHash) {
    throw new Error("LIBRARY_CUTOVER_VALIDATION_FAILED");
  }
}

async function importSnapshot(
  client: PoolClient,
  source: ImportedLibrarySnapshot,
  sourceHash: string,
): Promise<void> {
  const countResult = await client.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM papot_library_state",
  );
  if (countResult.rows[0]?.count !== "0") {
    throw new Error("LIBRARY_CUTOVER_STATE_INVALID");
  }

  await client.query(
    `
      INSERT INTO papot_library_state (
        scope,
        version,
        payload,
        updated_at,
        updated_by_user_id,
        updated_by_device_id
      )
      VALUES ('catalog', $1, $2, $3, $4, $5)
    `,
    [
      source.version,
      source.payload,
      source.updatedAt,
      source.updatedByUserId,
      source.updatedByDeviceId,
    ],
  );

  await validateImportedSnapshot(client, sourceHash);
  await client.query(
    `
      INSERT INTO papot_domain_cutovers (
        domain,
        source,
        source_hash,
        record_count
      )
      VALUES ($1, $2, $3, $4)
    `,
    [LIBRARY_CUTOVER_DOMAIN, LIBRARY_CUTOVER_SOURCE, sourceHash, recordCount(source.payload)],
  );
}

export async function ensureLibraryPostgresCutover(params: {
  pool?: Pool;
  acquireSource(): Promise<LockedLibrarySnapshot>;
}): Promise<void> {
  const pool = params.pool ?? getServerDbPool();
  if (await findCutoverMarker(pool)) return;

  const sourceLock = { current: null as LockedLibrarySnapshot | null };

  try {
    await withServerDbTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [LIBRARY_CUTOVER_LOCK_ID]);
      if (await findCutoverMarker(client)) return;

      sourceLock.current = await params.acquireSource();
      const source: ImportedLibrarySnapshot = {
        version: sourceLock.current.version,
        payload: parseLibraryPayload(sourceLock.current.payload),
        updatedAt: sourceLock.current.updatedAt,
        updatedByUserId: sourceLock.current.updatedByUserId,
        updatedByDeviceId: sourceLock.current.updatedByDeviceId,
      };
      const sourceHash = librarySnapshotHash(source);
      await importSnapshot(client, source, sourceHash);
    }, pool);
  } finally {
    const lockedSource = sourceLock.current;
    if (lockedSource) {
      await lockedSource.release().catch((error: unknown) => {
        const code = error instanceof Error ? error.message : "LIBRARY_CUTOVER_LOCK_RELEASE_FAILED";
        console.error("[PAPOT][Library] cutover lock release failed", { code });
      });
    }
  }
}
