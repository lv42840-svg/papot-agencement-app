import "server-only";

import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import { parseChantiersPayload } from "./domain";
import {
  ChantiersRepositoryError,
  type ChantiersMutationTransform,
  type ChantiersRepository,
} from "./repository";

type ChantiersStateRow = {
  version: number;
  payload: unknown;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

async function loadState(queryable: Queryable): Promise<ChantiersStateRow> {
  const result = await queryable.query<ChantiersStateRow>(
    "SELECT version, payload FROM papot_chantiers_state WHERE scope = 'global'",
  );
  const row = result.rows[0];
  if (!row) throw new Error("CHANTIERS_STORAGE_NOT_INITIALIZED");
  return row;
}

export function createPostgresChantiersRepository(
  pool: Pool = getServerDbPool(),
): ChantiersRepository {
  return {
    async load() {
      const row = await loadState(pool);
      return parseChantiersPayload(row.payload);
    },

    async mutate(transform: ChantiersMutationTransform) {
      return withServerDbTransaction(async (client) => {
        const locked = await client.query<ChantiersStateRow>(
          `
            SELECT version, payload
            FROM papot_chantiers_state
            WHERE scope = 'global'
            FOR UPDATE
          `,
        );
        const row = locked.rows[0];
        if (!row) throw new Error("CHANTIERS_STORAGE_NOT_INITIALIZED");

        const mutation = await transform(parseChantiersPayload(row.payload), false);
        if (mutation.shouldPersist === false) {
          return {
            payload: parseChantiersPayload(mutation.payload),
            focusChantierId: mutation.focusChantierId,
          };
        }

        const saved = await client.query<{ payload: unknown }>(
          `
            UPDATE papot_chantiers_state
            SET version = version + 1,
                payload = $1,
                updated_at = NOW()
            WHERE scope = 'global' AND version = $2
            RETURNING payload
          `,
          [mutation.payload, row.version],
        );
        if (saved.rowCount === 0) {
          throw new ChantiersRepositoryError("CHANTIERS_VERSION_CONFLICT");
        }

        return {
          payload: parseChantiersPayload(saved.rows[0]?.payload),
          focusChantierId: mutation.focusChantierId,
        };
      }, pool);
    },
  };
}
