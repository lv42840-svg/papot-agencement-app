import "server-only";

import { isLocalStorageMode, mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations, withServerDbTransaction } from "@/lib/server-db";
import { parseBillingPayload, type BillingPayload } from "./domain";

const RESOURCE_KEY = "billing";
type BillingTransform = (donnees: BillingPayload) => BillingPayload | Promise<BillingPayload>;

export type BillingRepository = {
  load(): Promise<BillingPayload>;
  mutate(transformation: BillingTransform): Promise<BillingPayload>;
};

export function createBillingRepository(): BillingRepository {
  if (isLocalStorageMode()) {
    return {
      async load() {
        return readLocalSnapshot(RESOURCE_KEY, parseBillingPayload).payload;
      },
      mutate(transformation) {
        return mutateLocalSnapshot(
          RESOURCE_KEY,
          parseBillingPayload,
          async ({ payload: donnees }) => {
            const donneesSuivantes = parseBillingPayload(
              await transformation(structuredClone(donnees)),
            );
            return {
              payload: donneesSuivantes,
              result: donneesSuivantes,
            };
          },
        );
      },
    };
  }

  const pool = getServerDbPool();
  const initialisation = runServerDbMigrations(pool);
  return {
    async load() {
      await initialisation;
      const resultat = await pool.query<{ payload: unknown }>(
        "SELECT payload FROM papot_billing_state WHERE scope = 'global'",
      );
      return parseBillingPayload(resultat.rows[0]?.payload);
    },
    async mutate(transformation) {
      await initialisation;
      return withServerDbTransaction(async (client) => {
        const resultat = await client.query<{
          payload: unknown;
          version: number;
        }>("SELECT payload, version FROM papot_billing_state WHERE scope = 'global' FOR UPDATE");
        const ligne = resultat.rows[0];
        if (!ligne) throw new Error("BILLING_STORAGE_NOT_INITIALIZED");
        const donneesSuivantes = parseBillingPayload(
          await transformation(parseBillingPayload(ligne.payload)),
        );
        await client.query(
          "UPDATE papot_billing_state SET version = version + 1, payload = $1::jsonb, updated_at = NOW() WHERE scope = 'global'",
          [JSON.stringify(donneesSuivantes)],
        );
        return donneesSuivantes;
      }, pool);
    },
  };
}
