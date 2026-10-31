import "server-only";

import { isLocalStorageMode, mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations, withServerDbTransaction } from "@/lib/server-db";
import { parsePurchaseOrdersPayload, type PurchaseOrdersPayload } from "./domain";

const RESOURCE_KEY = "purchase-orders";
type Transform = (
  payload: PurchaseOrdersPayload,
) => PurchaseOrdersPayload | Promise<PurchaseOrdersPayload>;

export function createPurchaseOrdersRepository() {
  if (isLocalStorageMode()) {
    return {
      async load() {
        return readLocalSnapshot(RESOURCE_KEY, parsePurchaseOrdersPayload).payload;
      },
      mutate(transform: Transform) {
        return mutateLocalSnapshot(
          RESOURCE_KEY,
          parsePurchaseOrdersPayload,
          async ({ payload }) => {
            const next = parsePurchaseOrdersPayload(await transform(structuredClone(payload)));
            return { payload: next, result: next };
          },
        );
      },
    };
  }
  const pool = getServerDbPool();
  const ready = runServerDbMigrations(pool);
  return {
    async load(): Promise<PurchaseOrdersPayload> {
      await ready;
      const rows = await pool.query<{ payload: unknown }>(
        "SELECT payload FROM papot_purchase_orders_state WHERE scope = 'global'",
      );
      return parsePurchaseOrdersPayload(rows.rows[0]?.payload);
    },
    async mutate(transform: Transform): Promise<PurchaseOrdersPayload> {
      await ready;
      return withServerDbTransaction(async (client) => {
        const rows = await client.query<{ payload: unknown }>(
          "SELECT payload FROM papot_purchase_orders_state WHERE scope = 'global' FOR UPDATE",
        );
        if (!rows.rows[0]) throw new Error("PURCHASE_ORDER_STORAGE_NOT_INITIALIZED");
        const next = parsePurchaseOrdersPayload(
          await transform(parsePurchaseOrdersPayload(rows.rows[0].payload)),
        );
        await client.query(
          "UPDATE papot_purchase_orders_state SET version = version + 1, payload = $1::jsonb, updated_at = NOW() WHERE scope = 'global'",
          [JSON.stringify(next)],
        );
        return next;
      }, pool);
    },
  };
}
