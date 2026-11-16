import "server-only";

import type { Pool } from "pg";
import { getServerDbPool } from "@/lib/server-db/pool";
import { runServerDbMigrations } from "@/lib/server-db/migrations";
import { withServerDbTransaction } from "@/lib/server-db/transaction";
import { listPennylaneResource, verifyPennylaneCompany } from "./client";
import { readPennylaneStoredConfig } from "./connection";
import { pennylaneEnabled } from "./config";

export type SupplierCatalog = {
  suppliers: Array<{ id: string; name: string }>;
  synced: boolean;
  syncedAt: string | null;
};

export async function readSupplierCatalog(pool: Pool = getServerDbPool()): Promise<SupplierCatalog> {
  await runServerDbMigrations(pool);
  const [rows, status] = await Promise.all([
    pool.query<{ external_id: string; payload: { name?: unknown } }>(
      "SELECT external_id, payload FROM papot_pennylane_staging WHERE resource = 'suppliers' ORDER BY external_id LIMIT 20001",
    ),
    pool.query<{ synced_at: Date }>(
      "SELECT synced_at FROM papot_pennylane_sync_state WHERE resource = 'suppliers'",
    ),
  ]);
  return {
    suppliers: rows.rows.slice(0, 20000).map(row => ({
      id: row.external_id,
      name: typeof row.payload.name === "string" && row.payload.name.trim()
        ? row.payload.name.trim() : "Fournisseur #" + row.external_id,
    })),
    synced: Boolean(status.rows[0]),
    syncedAt: status.rows[0]?.synced_at.toISOString() ?? null,
  };
}

/** Only updates the isolated supplier snapshot; invoice data is never touched. */
export async function refreshSupplierCatalog(pool: Pool = getServerDbPool()): Promise<number> {
  if (!pennylaneEnabled()) throw new Error("PENNYLANE_DISABLED");
  const config = await readPennylaneStoredConfig(pool);
  const company = await verifyPennylaneCompany(config);
  const suppliers = await listPennylaneResource("suppliers", config);
  await withServerDbTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock($1)", ["7332170416238558"]);
    await client.query("DELETE FROM papot_pennylane_staging WHERE resource = 'suppliers'");
    if (suppliers.length > 0) {
      await client.query(
        "INSERT INTO papot_pennylane_staging (resource, external_id, payload, synced_at) SELECT 'suppliers', r.id, r.payload, NOW() FROM jsonb_to_recordset($1::jsonb) AS r(id text, payload jsonb)",
        [JSON.stringify(suppliers.map(supplier => ({ id: String(supplier.id), payload: supplier })))],
      );
    }
    await client.query(
      "INSERT INTO papot_pennylane_sync_state (resource, company_name, synced_at, item_count) VALUES ('suppliers', $1, NOW(), $2) ON CONFLICT (resource) DO UPDATE SET company_name = EXCLUDED.company_name, synced_at = NOW(), item_count = EXCLUDED.item_count",
      [company, suppliers.length],
    );
  }, pool);
  return suppliers.length;
}
