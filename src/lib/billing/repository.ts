import "server-only";

import { isLocalStorageMode, mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations, withServerDbTransaction } from "@/lib/server-db";
import { parseBillingPayload, type BillingPayload } from "./domain";

const RESOURCE_KEY = "billing";
type BillingTransform = (payload: BillingPayload) => BillingPayload | Promise<BillingPayload>;

export type BillingRepository = {
  load(): Promise<BillingPayload>;
  mutate(transform: BillingTransform): Promise<BillingPayload>;
};

export function createBillingRepository(): BillingRepository {
  if (isLocalStorageMode()) {
    return {
      async load() {
        return readLocalSnapshot(RESOURCE_KEY, parseBillingPayload).payload;
      },
      mutate(transform) {
        return mutateLocalSnapshot(RESOURCE_KEY, parseBillingPayload, async ({ payload }) => {
          const next = parseBillingPayload(await transform(structuredClone(payload)));
          return { payload: next, result: next };
        });
      },
    };
  }

  const pool = getServerDbPool();
  const initialize = runServerDbMigrations(pool);
  return {
    async load() {
      await initialize;
      const result = await pool.query<{ payload: unknown }>(
        "SELECT payload FROM papot_billing_state WHERE scope = 'global'",
      );
      return parseBillingPayload(result.rows[0]?.payload);
    },
    async mutate(transform) {
      await initialize;
      return withServerDbTransaction(async (client) => {
        const result = await client.query<{ payload: unknown; version: number }>(
          "SELECT payload, version FROM papot_billing_state WHERE scope = 'global' FOR UPDATE",
        );
        const row = result.rows[0];
        if (!row) throw new Error("BILLING_STORAGE_NOT_INITIALIZED");
        const next = parseBillingPayload(await transform(parseBillingPayload(row.payload)));
        await client.query(
          "UPDATE papot_billing_state SET version = version + 1, payload = $1::jsonb, updated_at = NOW() WHERE scope = 'global'",
          [JSON.stringify(next)],
        );
        return next;
      }, pool);
    },
  };
}
