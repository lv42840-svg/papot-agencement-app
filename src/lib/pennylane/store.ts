import type { Pool } from "pg";
import { getServerDbPool } from "@/lib/server-db/pool";
import { runServerDbMigrations } from "@/lib/server-db/migrations";
import { withServerDbTransaction } from "@/lib/server-db/transaction";
import { PENNYLANE_RESOURCES, type PennylaneResource } from "./config";
import type { PennylaneItem } from "./client";

export type PennylaneSnapshot = {
  resource: PennylaneResource;
  companyName: string;
  syncedAt: string;
  count: number;
};

export async function getPennylaneSnapshots(
  pool: Pool = getServerDbPool(),
): Promise<PennylaneSnapshot[]> {
  const result = await pool.query<{
    resource: PennylaneResource;
    company_name: string;
    synced_at: Date;
    item_count: number;
  }>(`SELECT resource, company_name, synced_at, item_count
      FROM papot_pennylane_sync_state ORDER BY resource`);
  return result.rows.map((row) => ({
    resource: row.resource,
    companyName: row.company_name,
    syncedAt: row.synced_at.toISOString(),
    count: row.item_count,
  }));
}

/**
 * All-or-nothing replacement of four isolated staging datasets.
 * Before replacement, preserves the last known source of PAPOT-approved supplier
 * invoices. Financial dashboards continue reading their validated allocations
 * when Pennylane no longer returns an old invoice.
 */
export async function publishPennylaneSnapshots(
  companyName: string,
  records: Record<PennylaneResource, PennylaneItem[]>,
  pool: Pool = getServerDbPool(),
): Promise<PennylaneSnapshot[]> {
  await runServerDbMigrations(pool);
  const syncedAt = new Date();
  await withServerDbTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", ["7332170416238558"]);
    for (const resource of PENNYLANE_RESOURCES) {
      if (resource === "supplier_invoices") {
        // Retain only invoices already approved in PAPOT before replacing the
        // snapshot. This does not duplicate their financial allocation.
        await client.query(`
          INSERT INTO papot_pennylane_supplier_invoice_archive
            (invoice_id, payload, last_seen_at)
          SELECT s.external_id, s.payload, s.synced_at
          FROM papot_pennylane_staging s
          INNER JOIN papot_pennylane_purchase_allocations a
            ON a.invoice_id = s.external_id AND a.approved IS NOT NULL
          WHERE s.resource = 'supplier_invoices'
          ON CONFLICT (invoice_id) DO UPDATE SET
            payload = EXCLUDED.payload,
            last_seen_at = EXCLUDED.last_seen_at
        `);
      }
      await client.query("DELETE FROM papot_pennylane_staging WHERE resource = $1", [resource]);
      // Bulk insert rather than 1 SQL round trip per invoice.
      const rows = records[resource].map((item) => ({
        resource,
        externalId: String(item.id),
        payload: item,
      }));
      if (rows.length) {
        await client.query(
          `INSERT INTO papot_pennylane_staging (resource, external_id, payload, synced_at)
           SELECT source.resource, source.external_id, source.payload, $2::timestamptz
           FROM jsonb_to_recordset($1::jsonb)
             AS source(resource text, external_id text, payload jsonb)`,
          [
            JSON.stringify(
              rows.map((row) => ({
                resource: row.resource,
                external_id: row.externalId,
                payload: row.payload,
              })),
            ),
            syncedAt.toISOString(),
          ],
        );
      }
      await client.query(
        `INSERT INTO papot_pennylane_sync_state
          (resource, company_name, synced_at, item_count)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (resource) DO UPDATE SET
          company_name = EXCLUDED.company_name,
          synced_at = EXCLUDED.synced_at,
          item_count = EXCLUDED.item_count`,
        [resource, companyName, syncedAt, rows.length],
      );
    }
  }, pool);
  return PENNYLANE_RESOURCES.map((resource) => ({
    resource,
    companyName,
    syncedAt: syncedAt.toISOString(),
    count: records[resource].length,
  }));
}
