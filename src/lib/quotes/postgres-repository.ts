import "server-only";

import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import {
  QuotesRepositoryError,
  type QuotesMutationTransform,
  type QuotesRepository,
} from "./repository";
import { parseNativeQuotesPayload } from "./store";

type QuotesStateRow = {
  version: number;
  payload: unknown;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

async function loadState(queryable: Queryable): Promise<QuotesStateRow> {
  const resultat = await queryable.query<QuotesStateRow>(
    "SELECT version, payload FROM papot_quotes_state WHERE scope = 'global'",
  );
  const ligneTableau = resultat.rows[0];
  if (!ligneTableau) throw new Error("QUOTES_STORAGE_NOT_INITIALIZED");
  return ligneTableau;
}

export function createPostgresQuotesRepository(pool: Pool = getServerDbPool()): QuotesRepository {
  return {
    async load() {
      const ligneTableau = await loadState(pool);
      return parseNativeQuotesPayload(ligneTableau.payload);
    },

    async mutate(transform: QuotesMutationTransform) {
      return withServerDbTransaction(async (client) => {
        const locked = await client.query<QuotesStateRow>(
          `
            SELECT version, payload
            FROM papot_quotes_state
            WHERE scope = 'global'
            FOR UPDATE
          `,
        );
        const ligneTableau = locked.rows[0];
        if (!ligneTableau) throw new Error("QUOTES_STORAGE_NOT_INITIALIZED");

        const mutation = await transform(parseNativeQuotesPayload(ligneTableau.payload));
        if (mutation.shouldPersist === false) {
          return {
            payload: parseNativeQuotesPayload(mutation.payload),
            focusQuoteId: mutation.focusQuoteId,
          };
        }

        const saved = await client.query<{ payload: unknown }>(
          `
            UPDATE papot_quotes_state
            SET version = version + 1,
                payload = $1,
                updated_at = NOW()
            WHERE scope = 'global' AND version = $2
            RETURNING payload
          `,
          [mutation.payload, ligneTableau.version],
        );
        if (saved.rowCount === 0) {
          throw new QuotesRepositoryError("QUOTES_VERSION_CONFLICT");
        }

        return {
          payload: parseNativeQuotesPayload(saved.rows[0]?.payload),
          focusQuoteId: mutation.focusQuoteId,
        };
      }, pool);
    },
  };
}
