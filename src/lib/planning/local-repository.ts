import { freezeHourSchedules, hasUnfrozenHours } from "./hour-schedules";
import "server-only";

import { mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import { parsePlanningPayload } from "./domain";
import type { PlanningRepository } from "./repository";

const RESOURCE_KEY = "planning";

export function createLocalPlanningRepository(): PlanningRepository {
  return {
    async load() {
      const current = readLocalSnapshot(RESOURCE_KEY, parsePlanningPayload).payload;
      if (!hasUnfrozenHours(current)) return current;
      return mutateLocalSnapshot(RESOURCE_KEY, parsePlanningPayload, ({ payload }) => {
        const next = freezeHourSchedules(payload);
        return { payload: next, result: next };
      });
    },

    async mutate(transform) {
      return mutateLocalSnapshot(RESOURCE_KEY, parsePlanningPayload, async ({ payload }) => {
        const next = freezeHourSchedules(
          parsePlanningPayload(await transform(structuredClone(payload))),
          payload,
        );
        return {
          payload: next,
          result: next,
          persist: true,
        };
      });
    },
  };
}
