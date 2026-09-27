import "server-only";

import { mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import { parsePlanningPayload } from "./domain";
import type { PlanningRepository } from "./repository";

const RESOURCE_KEY = "planning";

export function createLocalPlanningRepository(): PlanningRepository {
  return {
    async load() {
      return readLocalSnapshot(RESOURCE_KEY, parsePlanningPayload).payload;
    },

    async mutate(transform) {
      return mutateLocalSnapshot(RESOURCE_KEY, parsePlanningPayload, async ({ payload }) => {
        const next = parsePlanningPayload(await transform(structuredClone(payload)));
        return {
          payload: next,
          result: next,
          persist: true,
        };
      });
    },
  };
}
