import "server-only";

import {
  mutateLocalSnapshot,
  readLocalSnapshot,
} from "@/lib/local-db/runtime";
import { parsePlanningPayload } from "./domain";
import type { PlanningRepository } from "./repository";

const RESOURCE_KEY = "planning";

export function createLocalPlanningRepository(): PlanningRepository {
  return {
    async load() {
      return readLocalSnapshot(
        RESOURCE_KEY,
        parsePlanningPayload,
      ).payload;
    },

    async mutate(transformation) {
      return mutateLocalSnapshot(
        RESOURCE_KEY,
        parsePlanningPayload,
        async ({ payload: donnees }) => {
          const donneesSuivantes = parsePlanningPayload(
            await transformation(
              structuredClone(donnees),
            ),
          );
          return {
            payload: donneesSuivantes,
            result: donneesSuivantes,
            persist: true,
          };
        },
      );
    },
  };
}
