import "server-only";

import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import { parseNativeQuotesPayload, type NativeQuotesPayload } from "./store";

const QUOTES_CUTOVER_DOMAIN = "quotes";
const QUOTES_CUTOVER_SOURCE = "local:quotes";
const QUOTES_CUTOVER_LOCK_ID = 7_332_170_416_238_513;

type CutoverMarkerRow = {
  source_hash: string;
  record_count: number;
};

export function quotesPayloadHash(payload: NativeQuotesPayload): string {
  return createHash("sha256")
    .update(JSON.stringify(parseNativeQuotesPayload(payload)))
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
    [QUOTES_CUTOVER_DOMAIN],
  );
  return result.rows[0] ?? null;
}

async function validateImportedSnapshot(client: PoolClient, expectedHash: string): Promise<void> {
  const result = await client.query<{ payload: unknown }>(
    "SELECT payload FROM papot_quotes_state WHERE scope = 'global'",
  );
  const imported = parseNativeQuotesPayload(result.rows[0]?.payload);
  if (quotesPayloadHash(imported) !== expectedHash) {
    throw new Error("QUOTES_CUTOVER_VALIDATION_FAILED");
  }
}

async function importSnapshot(
  client: PoolClient,
  source: NativeQuotesPayload,
  sourceHash: string,
): Promise<void> {
  const countResult = await client.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM papot_quotes_state",
  );
  if (countResult.rows[0]?.count !== "0") {
    throw new Error("QUOTES_CUTOVER_STATE_INVALID");
  }

  await client.query(
    `
      INSERT INTO papot_quotes_state (scope, version, payload)
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
    [QUOTES_CUTOVER_DOMAIN, QUOTES_CUTOVER_SOURCE, sourceHash, source.quotes.length],
  );
}

export async function ensureQuotesPostgresCutover(params: {
  pool?: Pool;
  acquireSource(): Promise<NativeQuotesPayload>;
}): Promise<void> {
  const pool = params.pool ?? getServerDbPool();
  if (await findCutoverMarker(pool)) return;

  await withServerDbTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [QUOTES_CUTOVER_LOCK_ID]);
    if (await findCutoverMarker(client)) return;

    const source = parseNativeQuotesPayload(await params.acquireSource());
    const sourceHash = quotesPayloadHash(source);
    await importSnapshot(client, source, sourceHash);
  }, pool);
}
