import "server-only";

import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "@/lib/server-db/pool";
import { withServerDbTransaction } from "@/lib/server-db/transaction";
import { parseClientsPayload, type ClientsPayload } from "./domain";

const CLIENTS_CUTOVER_DOMAIN = "clients";
const CLIENTS_CUTOVER_SOURCE = "nextcloud:CLIENTS/global";
const CLIENTS_CUTOVER_LOCK_ID = 7_332_170_416_238_503;

type CutoverMarkerRow = {
  source_hash: string;
  record_count: number;
};

export type LockedClientsSnapshot = {
  payload: ClientsPayload;
  release(): Promise<void>;
};

export function clientsPayloadHash(payload: ClientsPayload): string {
  return createHash("sha256").update(JSON.stringify(parseClientsPayload(payload))).digest("hex");
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
    [CLIENTS_CUTOVER_DOMAIN],
  );
  return result.rows[0] ?? null;
}

async function validateImportedSnapshot(
  client: PoolClient,
  source: ClientsPayload,
  expectedHash: string,
): Promise<void> {
  const result = await client.query<{ id: string; record: unknown }>(`
    SELECT id, record
    FROM papot_clients
    ORDER BY sort_order ASC, id ASC
  `);
  const imported = parseClientsPayload({
    schemaVersion: 1,
    clients: result.rows.map((row) => row.record),
  });

  const sourceIds = source.clients.map((record) => record.id);
  const importedIds = imported.clients.map((record) => record.id);
  const idsMatch =
    sourceIds.length === importedIds.length &&
    sourceIds.every((clientId, index) => clientId === importedIds[index]);

  if (!idsMatch || clientsPayloadHash(imported) !== expectedHash) {
    throw new Error("CLIENTS_CUTOVER_VALIDATION_FAILED");
  }
}

async function importSnapshot(
  client: PoolClient,
  source: ClientsPayload,
  sourceHash: string,
): Promise<void> {
  const countResult = await client.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM papot_clients",
  );
  if (countResult.rows[0]?.count !== "0") {
    throw new Error("CLIENTS_CUTOVER_STATE_INVALID");
  }

  for (const [index, record] of source.clients.entries()) {
    await client.query(
      `
        INSERT INTO papot_clients (
          id,
          version,
          siret,
          sort_order,
          record,
          created_at,
          updated_at
        )
        VALUES ($1, 1, $2, $3, $4, $5, $6)
      `,
      [
        record.id,
        record.siret || null,
        index,
        record,
        record.createdAt,
        record.updatedAt,
      ],
    );
  }

  await validateImportedSnapshot(client, source, sourceHash);
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
    [CLIENTS_CUTOVER_DOMAIN, CLIENTS_CUTOVER_SOURCE, sourceHash, source.clients.length],
  );
}

export async function ensureClientsPostgresCutover(params: {
  pool?: Pool;
  acquireSource(): Promise<LockedClientsSnapshot>;
}): Promise<void> {
  const pool = params.pool ?? getServerDbPool();
  if (await findCutoverMarker(pool)) return;

  let lockedSource: LockedClientsSnapshot | null = null;

  try {
    await withServerDbTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [CLIENTS_CUTOVER_LOCK_ID]);
      if (await findCutoverMarker(client)) return;

      lockedSource = await params.acquireSource();
      const source = parseClientsPayload(lockedSource.payload);
      const sourceHash = clientsPayloadHash(source);
      await importSnapshot(client, source, sourceHash);
    }, pool);
  } finally {
    if (lockedSource) {
      await lockedSource.release().catch((error: unknown) => {
        const code = error instanceof Error ? error.message : "CLIENTS_CUTOVER_LOCK_RELEASE_FAILED";
        console.error("[PAPOT][Clients] cutover lock release failed", { code });
      });
    }
  }
}
