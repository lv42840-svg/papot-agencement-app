import "server-only";

import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import { parseChantiersPayload, type ChantiersPayload } from "./domain";

const CHANTIERS_CUTOVER_DOMAIN = "chantiers";
const CHANTIERS_CUTOVER_SOURCE = "nextcloud:CHANTIER/registry";
const CHANTIERS_CUTOVER_LOCK_ID = 7_332_170_416_238_510;

type CutoverMarkerRow = {
  source_hash: string;
  record_count: number;
};

export type LockedChantiersSnapshot = {
  payload: ChantiersPayload;
  release(): Promise<void>;
};

export function chantiersPayloadHash(payload: ChantiersPayload): string {
  return createHash("sha256")
    .update(JSON.stringify(parseChantiersPayload(payload)))
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
    [CHANTIERS_CUTOVER_DOMAIN],
  );
  return result.rows[0] ?? null;
}

async function validateImportedSnapshot(client: PoolClient, expectedHash: string): Promise<void> {
  const result = await client.query<{ payload: unknown }>(
    "SELECT payload FROM papot_chantiers_state WHERE scope = 'global'",
  );
  const imported = parseChantiersPayload(result.rows[0]?.payload);

  if (chantiersPayloadHash(imported) !== expectedHash) {
    throw new Error("CHANTIERS_CUTOVER_VALIDATION_FAILED");
  }
}

async function importSnapshot(
  client: PoolClient,
  source: ChantiersPayload,
  sourceHash: string,
): Promise<void> {
  const countResult = await client.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM papot_chantiers_state",
  );
  if (countResult.rows[0]?.count !== "0") {
    throw new Error("CHANTIERS_CUTOVER_STATE_INVALID");
  }

  await client.query(
    `
      INSERT INTO papot_chantiers_state (scope, version, payload)
      VALUES ('global', 1, $1)
    `,
    [source],
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
    [CHANTIERS_CUTOVER_DOMAIN, CHANTIERS_CUTOVER_SOURCE, sourceHash, source.chantiers.length],
  );
}

export async function ensureChantiersPostgresCutover(params: {
  pool?: Pool;
  acquireSource(): Promise<LockedChantiersSnapshot>;
}): Promise<void> {
  const pool = params.pool ?? getServerDbPool();
  if (await findCutoverMarker(pool)) return;

  const sourceLock = { current: null as LockedChantiersSnapshot | null };

  try {
    await withServerDbTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [CHANTIERS_CUTOVER_LOCK_ID]);
      if (await findCutoverMarker(client)) return;

      sourceLock.current = await params.acquireSource();
      const source = parseChantiersPayload(sourceLock.current.payload);
      const sourceHash = chantiersPayloadHash(source);
      await importSnapshot(client, source, sourceHash);
    }, pool);
  } finally {
    const lockedSource = sourceLock.current;
    if (lockedSource) {
      await lockedSource.release().catch((error: unknown) => {
        const code =
          error instanceof Error ? error.message : "CHANTIERS_CUTOVER_LOCK_RELEASE_FAILED";
        console.error("[PAPOT][Chantiers] cutover lock release failed", { code });
      });
    }
  }
}
