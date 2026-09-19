import "server-only";

import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import { parseCommercialPayload } from "./domain";
import {
  CommercialRepositoryError,
  type CommercialMutationTransform,
  type CommercialRepository,
} from "./repository";

type CommercialStateRow = {
  version: number;
  payload: unknown;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

async function loadState(queryable: Queryable): Promise<CommercialStateRow> {
  const result = await queryable.query<CommercialStateRow>(
    "SELECT version, payload FROM papot_commercial_state WHERE scope = 'global'",
  );
  const row = result.rows[0];
  if (!row) throw new Error("COMMERCIAL_STORAGE_NOT_INITIALIZED");
  return row;
}

export function createPostgresCommercialRepository(
  pool: Pool = getServerDbPool(),
): CommercialRepository {
  return {
    async load() {
      const row = await loadState(pool);
      return parseCommercialPayload(row.payload);
    },

    async mutate(transform: CommercialMutationTransform) {
      return withServerDbTransaction(async (client) => {
        const locked = await client.query<CommercialStateRow>(
          `
            SELECT version, payload
            FROM papot_commercial_state
            WHERE scope = 'global'
            FOR UPDATE
          `,
        );
        const row = locked.rows[0];
        if (!row) throw new Error("COMMERCIAL_STORAGE_NOT_INITIALIZED");

        const mutation = await transform(parseCommercialPayload(row.payload), false);
        if (mutation.shouldPersist === false) {
          return {
            payload: parseCommercialPayload(mutation.payload),
            focusCaseId: mutation.focusCaseId,
          };
        }

        const saved = await client.query<{ payload: unknown }>(
          `
            UPDATE papot_commercial_state
            SET version = version + 1,
                payload = $1,
                updated_at = NOW()
            WHERE scope = 'global' AND version = $2
            RETURNING payload
          `,
          [mutation.payload, row.version],
        );
        if (saved.rowCount === 0) {
          throw new CommercialRepositoryError("COMMERCIAL_VERSION_CONFLICT");
        }

        return {
          payload: parseCommercialPayload(saved.rows[0]?.payload),
          focusCaseId: mutation.focusCaseId,
        };
      }, pool);
    },
  };
}
