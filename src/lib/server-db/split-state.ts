import "server-only";
import type { PoolClient } from "pg";

type StateTable = "papot_planning_state" | "papot_monthly_labor_costs_state";
export const planningCollections = ["actualHours", "indirectHours", "editHistory"] as const;
export const laborCollections = ["records", "history", "editHistory"] as const;
const marker = "_rowStorageV1";

export async function ensureSplitStorage(client: PoolClient) {
  await client.query(`CREATE TABLE IF NOT EXISTS papot_state_rows (
    resource TEXT NOT NULL, collection TEXT NOT NULL, record_key TEXT NOT NULL,
    position INTEGER NOT NULL CHECK(position >= 0), payload JSONB NOT NULL,
    PRIMARY KEY(resource,collection,record_key))`);
  await client.query(`CREATE TABLE IF NOT EXISTS papot_state_migration_backups (
    resource TEXT PRIMARY KEY, payload JSONB NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
}
function rowKey(collection: string, row: Record<string, unknown>, index: number) {
  if (collection === "actualHours")
    return JSON.stringify([row.week, row.userId, row.chantierId, row.activity]);
  if (collection === "indirectHours") return JSON.stringify([row.week, row.userId, row.category]);
  if (collection === "records") return JSON.stringify([row.month, row.personId]);
  return String(index); // Append-only history retains its original order and duplicates.
}
export async function saveSplitState(
  client: PoolClient,
  table: StateTable,
  collections: readonly string[],
  value: Record<string, unknown>,
) {
  const metadata: Record<string, unknown> = {
    ...value,
    [marker]: true,
    _hasEditHistory: value.editHistory !== undefined,
  };
  for (const collection of collections) {
    const rows = (value[collection] as Array<Record<string, unknown>> | undefined) ?? [];
    const records = rows.map((payload, position) => ({
      key: rowKey(collection, payload, position),
      position,
      payload,
    }));
    if (new Set(records.map((row) => row.key)).size !== records.length)
      throw new Error("STATE_ROW_DUPLICATE");
    await client.query(
      `DELETE FROM papot_state_rows WHERE resource=$1 AND collection=$2 AND NOT (record_key = ANY($3::text[]))`,
      [table, collection, records.map((row) => row.key)],
    );
    await client.query(
      `INSERT INTO papot_state_rows AS stored (resource,collection,record_key,position,payload)
      SELECT $1,$2,item.key,item.position,item.payload FROM jsonb_to_recordset($3::jsonb) AS item(key TEXT,position INTEGER,payload JSONB)
      ON CONFLICT(resource,collection,record_key) DO UPDATE SET position=EXCLUDED.position,payload=EXCLUDED.payload
      WHERE stored.position IS DISTINCT FROM EXCLUDED.position OR stored.payload IS DISTINCT FROM EXCLUDED.payload`,
      [table, collection, JSON.stringify(records)],
    );
    delete metadata[collection];
  }
  await client.query(
    `UPDATE ${table} SET payload=$1::jsonb,version=version+1,updated_at=NOW() WHERE scope='global'`,
    [JSON.stringify(metadata)],
  );
}
/** Caller owns a transaction: the metadata row serializes legacy transforms and migration. */
export async function loadSplitState(
  client: PoolClient,
  table: StateTable,
  collections: readonly string[],
) {
  const result = await client.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM ${table} WHERE scope='global' FOR UPDATE`,
  );
  const payload = result.rows[0]?.payload;
  if (!payload) throw new Error("STATE_STORAGE_NOT_INITIALIZED");
  if (!payload[marker]) {
    await client.query(
      `INSERT INTO papot_state_migration_backups(resource,payload) VALUES($1,$2::jsonb) ON CONFLICT(resource) DO NOTHING`,
      [table, JSON.stringify(payload)],
    );
    await saveSplitState(client, table, collections, payload);
    return payload;
  }
  const rows = await client.query<{ collection: string; payload: unknown }>(
    `SELECT collection,payload FROM papot_state_rows WHERE resource=$1 ORDER BY collection,position,record_key`,
    [table],
  );
  const hydrated = { ...payload };
  for (const collection of collections)
    hydrated[collection] = rows.rows
      .filter((row) => row.collection === collection)
      .map((row) => row.payload);
  if (!payload._hasEditHistory) delete hydrated.editHistory;
  return hydrated;
}
