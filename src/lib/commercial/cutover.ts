import "server-only";

import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import { parseCommercialPayload, type CommercialPayload } from "./domain";

const COMMERCIAL_CUTOVER_DOMAIN = "commercial";
const COMMERCIAL_CUTOVER_SOURCE = "nextcloud:COMMERCIAL/global";
const COMMERCIAL_CUTOVER_LOCK_ID = 7_332_170_416_238_509;

type CutoverMarkerRow = {
  source_hash: string;
  record_count: number;
};

export type LockedCommercialSnapshot = {
  payload: CommercialPayload;
  release(): Promise<void>;
};

export function commercialPayloadHash(payload: CommercialPayload): string {
  return createHash("sha256")
    .update(JSON.stringify(parseCommercialPayload(payload)))
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
    [COMMERCIAL_CUTOVER_DOMAIN],
  );
  return result.rows[0] ?? null;
}

async function validateImportedSnapshot(client: PoolClient, expectedHash: string): Promise<void> {
  const result = await client.query<{ payload: unknown }>(
    "SELECT payload FROM papot_commercial_state WHERE scope = 'global'",
  );
  const imported = parseCommercialPayload(result.rows[0]?.payload);

  if (commercialPayloadHash(imported) !== expectedHash) {
    throw new Error("COMMERCIAL_CUTOVER_VALIDATION_FAILED");
  }
}

async function importSnapshot(
  client: PoolClient,
  source: CommercialPayload,
  sourceHash: string,
): Promise<void> {
  const countResult = await client.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM papot_commercial_state",
  );
  if (countResult.rows[0]?.count !== "0") {
    throw new Error("COMMERCIAL_CUTOVER_STATE_INVALID");
  }

  await client.query(
    `
      INSERT INTO papot_commercial_state (scope, version, payload)
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
    [COMMERCIAL_CUTOVER_DOMAIN, COMMERCIAL_CUTOVER_SOURCE, sourceHash, source.cases.length],
  );
}

export async function ensureCommercialPostgresCutover(params: {
  pool?: Pool;
  acquireSource(): Promise<LockedCommercialSnapshot>;
}): Promise<void> {
  const pool = params.pool ?? getServerDbPool();
  if (await findCutoverMarker(pool)) return;

  const sourceLock = { current: null as LockedCommercialSnapshot | null };

  try {
    await withServerDbTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [COMMERCIAL_CUTOVER_LOCK_ID]);
      if (await findCutoverMarker(client)) return;

      sourceLock.current = await params.acquireSource();
      const source = parseCommercialPayload(sourceLock.current.payload);
      const sourceHash = commercialPayloadHash(source);
      await importSnapshot(client, source, sourceHash);
    }, pool);
  } finally {
    const lockedSource = sourceLock.current;
    if (lockedSource) {
      await lockedSource.release().catch((error: unknown) => {
        const code =
          error instanceof Error ? error.message : "COMMERCIAL_CUTOVER_LOCK_RELEASE_FAILED";
        console.error("[PAPOT][Commercial] cutover lock release failed", { code });
      });
    }
  }
}
