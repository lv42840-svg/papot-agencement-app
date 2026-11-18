import { getPennylaneConfig, PENNYLANE_RESOURCES, type PennylaneResource } from "./config";
import {
  listPennylaneResource,
  verifyPennylaneCompany,
  type PennylaneFetcher,
  type PennylaneItem,
} from "./client";
import { publishPennylaneSnapshots } from "./store";
import type { GeneralExpensesAutoAllocationResult } from "./purchase-invoice-store";

export type PennylaneSyncResult = {
  companyName: string;
  counts: Record<PennylaneResource, number>;
  generalExpenses: GeneralExpensesAutoAllocationResult;
};

/** API Pennylane en lecture seule (GET). Aucun appel sans synchronisation explicite. */
export async function preparePennylaneSnapshot(
  env: Record<string, string | undefined> = process.env,
  fetcher: PennylaneFetcher = fetch,
): Promise<{ companyName: string; records: Record<PennylaneResource, PennylaneItem[]> }> {
  const config = getPennylaneConfig(env);
  const companyName = await verifyPennylaneCompany(config, fetcher);
  const records = {} as Record<PennylaneResource, PennylaneItem[]>;
  // Fail closed: a single failed resource prevents publication of any partial snapshot.
  for (const resource of PENNYLANE_RESOURCES) {
    records[resource] = await listPennylaneResource(resource, config, fetcher);
  }
  return { companyName, records };
}

/**
 * Manual and scheduled refresh share a session-level PostgreSQL lock. The
 * connection is discarded after the import to guarantee the lock is released,
 * even if the upstream API fails or a worker is interrupted.
 */
export async function synchronizePennylane(
  actor = "PAPOT · synchronisation Pennylane",
): Promise<PennylaneSyncResult> {
  const { getServerDbPool } = await import("@/lib/server-db/pool");
  const lockClient = await getServerDbPool().connect();
  try {
    const result = await lockClient.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS acquired",
      ["7332170416238559"],
    );
    if (!result.rows[0]?.acquired) throw new Error("PENNYLANE_SYNC_IN_PROGRESS");

    // GET-only upstream access. The encrypted provider token stays in PostgreSQL.
    const { readPennylaneStoredConfig } = await import("./connection");
    const stored = await readPennylaneStoredConfig();
    const { companyName, records } = await preparePennylaneSnapshot({
      PAPOT_PENNYLANE_ENABLED: process.env.PAPOT_PENNYLANE_ENABLED,
      PAPOT_PENNYLANE_API_TOKEN: stored.token,
      PAPOT_PENNYLANE_EXPECTED_COMPANY: stored.expectedCompany,
    });
    await publishPennylaneSnapshots(companyName, records);

    // Automatic FG allocation is the same whether the import was scheduled or manual.
    const { autoAllocateImportedGeneralExpensesInvoices } = await import(
      "./purchase-invoice-store"
    );
    const generalExpenses = await autoAllocateImportedGeneralExpensesInvoices(actor);
    return {
      generalExpenses,
      companyName,
      counts: Object.fromEntries(
        PENNYLANE_RESOURCES.map((resource) => [resource, records[resource].length]),
      ) as Record<PennylaneResource, number>,
    };
  } finally {
    // Ending this session releases the advisory lock without depending on a second SQL call.
    lockClient.release(true);
  }
}
