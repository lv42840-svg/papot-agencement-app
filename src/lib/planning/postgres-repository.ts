import "server-only";

import type { Pool, PoolClient } from "pg";
import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import { parsePlanningPayload } from "./domain";
import type { PlanningRepository } from "./repository";

type PlanningStateRow = {
  version: number;
  payload: unknown;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

async function loadState(sourceRequete: Queryable): Promise<PlanningStateRow> {
  const resultat = await sourceRequete.query<PlanningStateRow>(
    "SELECT version, payload FROM papot_planning_state WHERE scope = 'global'",
  );
  const ligne = resultat.rows[0];
  if (!ligne) {
    throw new Error("PLANNING_STORAGE_NOT_INITIALIZED");
  }
  return ligne;
}

export function createPostgresPlanningRepository(
  pool: Pool = getServerDbPool(),
): PlanningRepository {
  return {
    async load() {
      const ligne = await loadState(pool);
      return parsePlanningPayload(ligne.payload);
    },

    async mutate(transformation) {
      return withServerDbTransaction(async (client) => {
        const verrouillage = await client.query<PlanningStateRow>(
          `
            SELECT version, payload
            FROM papot_planning_state
            WHERE scope = 'global'
            FOR UPDATE
          `,
        );
        const ligne = verrouillage.rows[0];
        if (!ligne) {
          throw new Error("PLANNING_STORAGE_NOT_INITIALIZED");
        }

        const donneesSuivantes = parsePlanningPayload(
          await transformation(structuredClone(parsePlanningPayload(ligne.payload))),
        );

        const sauvegarde = await client.query<{
          payload: unknown;
        }>(
          `
            UPDATE papot_planning_state
            SET version = version + 1,
                payload = $1,
                updated_at = NOW()
            WHERE scope = 'global' AND version = $2
            RETURNING payload
          `,
          [donneesSuivantes, ligne.version],
        );
        if (sauvegarde.rowCount === 0) {
          throw new Error("PLANNING_VERSION_CONFLICT");
        }
        return parsePlanningPayload(sauvegarde.rows[0]?.payload);
      }, pool);
    },
  };
}
