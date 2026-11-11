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

async function loadState(sourceRequete: Queryable): Promise<ChantiersStateRow> {
  const resultat = await sourceRequete.query<ChantiersStateRow>(
    "SELECT version, payload FROM papot_chantiers_state WHERE scope = 'global'",
  );
  const ligne = resultat.rows[0];
  if (!ligne) {
    throw new Error("CHANTIERS_STORAGE_NOT_INITIALIZED");
  }
  return ligne;
}

export function createPostgresChantiersRepository(
  pool: Pool = getServerDbPool(),
): ChantiersRepository {
  return {
    async load() {
      const ligne = await loadState(pool);
      return parseChantiersPayload(ligne.payload);
    },

    async mutate(transformation: ChantiersMutationTransform) {
      return withServerDbTransaction(async (client) => {
        const verrouillage = await client.query<ChantiersStateRow>(
          `
            SELECT version, payload
            FROM papot_chantiers_state
            WHERE scope = 'global'
            FOR UPDATE
          `,
        );
        const ligne = verrouillage.rows[0];
        if (!ligne) {
          throw new Error("CHANTIERS_STORAGE_NOT_INITIALIZED");
        }

        const mutation = await transformation(parseChantiersPayload(ligne.payload), false);
        if (mutation.shouldPersist === false) {
          return {
            payload: parseChantiersPayload(mutation.payload),
            focusChantierId: mutation.focusChantierId,
          };
        }

        const sauvegarde = await client.query<{
          payload: unknown;
        }>(
          `
            UPDATE papot_chantiers_state
            SET version = version + 1,
                payload = $1,
                updated_at = NOW()
            WHERE scope = 'global' AND version = $2
            RETURNING payload
          `,
          [mutation.payload, ligne.version],
        );
        if (sauvegarde.rowCount === 0) {
          throw new ChantiersRepositoryError("CHANTIERS_VERSION_CONFLICT");
        }

        return {
          payload: parseChantiersPayload(sauvegarde.rows[0]?.payload),
          focusChantierId: mutation.focusChantierId,
        };
      }, pool);
    },
  };
}
