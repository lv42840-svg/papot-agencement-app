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

async function loadState(sourceRequete: Queryable): Promise<CommercialStateRow> {
  const resultat = await sourceRequete.query<CommercialStateRow>(
    "SELECT version, payload FROM papot_commercial_state WHERE scope = 'global'",
  );
  const ligne = resultat.rows[0];
  if (!ligne) {
    throw new Error("COMMERCIAL_STORAGE_NOT_INITIALIZED");
  }
  return ligne;
}

export function createPostgresCommercialRepository(
  pool: Pool = getServerDbPool(),
): CommercialRepository {
  return {
    async load() {
      const ligne = await loadState(pool);
      return parseCommercialPayload(ligne.payload);
    },

    async mutate(transformation: CommercialMutationTransform) {
      return withServerDbTransaction(async (client) => {
        const verrouillage = await client.query<CommercialStateRow>(
          `
            SELECT version, payload
            FROM papot_commercial_state
            WHERE scope = 'global'
            FOR UPDATE
          `,
        );
        const ligne = verrouillage.rows[0];
        if (!ligne) {
          throw new Error("COMMERCIAL_STORAGE_NOT_INITIALIZED");
        }

        const mutation = await transformation(parseCommercialPayload(ligne.payload), false);
        if (mutation.shouldPersist === false) {
          return {
            payload: parseCommercialPayload(mutation.payload),
            focusCaseId: mutation.focusCaseId,
          };
        }

        const sauvegarde = await client.query<{
          payload: unknown;
        }>(
          `
            UPDATE papot_commercial_state
            SET version = version + 1,
                payload = $1,
                updated_at = NOW()
            WHERE scope = 'global' AND version = $2
            RETURNING payload
          `,
          [mutation.payload, ligne.version],
        );
        if (sauvegarde.rowCount === 0) {
          throw new CommercialRepositoryError("COMMERCIAL_VERSION_CONFLICT");
        }

        return {
          payload: parseCommercialPayload(sauvegarde.rows[0]?.payload),
          focusCaseId: mutation.focusCaseId,
        };
      }, pool);
    },
  };
}
