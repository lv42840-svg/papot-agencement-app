import "server-only";

import type { Pool, PoolClient } from "pg";
import { getServerDbPool } from "@/lib/server-db/pool";
import { withServerDbTransaction } from "@/lib/server-db/transaction";
import { parsePlanningPayload } from "./domain";
import type { PlanningRepository } from "./repository";

type PlanningStateRow = {
  version: number;
  payload: unknown;
};

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

async function loadState(queryable: Queryable): Promise<PlanningStateRow> {
  const result = await queryable.query<PlanningStateRow>(
    "SELECT version, payload FROM papot_planning_state WHERE scope = 'global'",
  );
  const row = result.rows[0];
  if (!row) throw new Error("PLANNING_STORAGE_NOT_INITIALIZED");
  return row;
}

export function createPostgresPlanningRepository(
  pool: Pool = getServerDbPool(),
): PlanningRepository {
  return {
    async load() {
      const row = await loadState(pool);
      return parsePlanningPayload(row.payload);
    },

    async mutate(transform) {
      return withServerDbTransaction(async (client) => {
        const locked = await client.query<PlanningStateRow>(
          `
            SELECT version, payload
            FROM papot_planning_state
            WHERE scope = 'global'
            FOR UPDATE
          `,
        );
        const row = locked.rows[0];
        if (!row) throw new Error("PLANNING_STORAGE_NOT_INITIALIZED");

        const next = parsePlanningPayload(
          await transform(structuredClone(parsePlanningPayload(row.payload))),
        );

        const saved = await client.query<{ payload: unknown }>(
          `
            UPDATE papot_planning_state
            SET version = version + 1,
                payload = $1,
                updated_at = NOW()
            WHERE scope = 'global' AND version = $2
            RETURNING payload
          `,
          [next, row.version],
        );
        if (saved.rowCount === 0) throw new Error("PLANNING_VERSION_CONFLICT");
        return parsePlanningPayload(saved.rows[0]?.payload);
      }, pool);
    },
  };
}
