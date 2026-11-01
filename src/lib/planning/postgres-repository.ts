import { freezeHourSchedules, hasUnfrozenHours } from "./hour-schedules";
import "server-only";
import type { Pool } from "pg";
import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import { loadSplitState, saveSplitState, planningCollections } from "../server-db/split-state";
import { parsePlanningPayload } from "./domain";
import type { PlanningRepository } from "./repository";
export function createPostgresPlanningRepository(
  pool: Pool = getServerDbPool(),
): PlanningRepository {
  return {
    async load() {
      return withServerDbTransaction(async (client) => {
        const current = parsePlanningPayload(
          await loadSplitState(client, "papot_planning_state", planningCollections),
        );
        if (!hasUnfrozenHours(current)) return current;
        const frozen = freezeHourSchedules(current);
        await saveSplitState(client, "papot_planning_state", planningCollections, frozen, false);
        return frozen;
      }, pool);
    },
    async mutate(transform) {
      return withServerDbTransaction(async (client) => {
        const current = parsePlanningPayload(
          await loadSplitState(client, "papot_planning_state", planningCollections),
        );
        const next = freezeHourSchedules(
          parsePlanningPayload(await transform(structuredClone(current))),
          current,
        );
        await saveSplitState(client, "papot_planning_state", planningCollections, next);
        return next;
      }, pool);
    },
  };
}
