import "server-only";

import {
  mutateLocalSnapshot,
  readLocalSnapshot,
} from "@/lib/local-db/runtime";
import { parseCommercialPayload } from "./domain";
import type { CommercialRepository } from "./repository";

const RESOURCE_KEY = "commercial";

export function createLocalCommercialRepository(): CommercialRepository {
  return {
    async load() {
      return readLocalSnapshot(
        RESOURCE_KEY,
        parseCommercialPayload,
      ).payload;
    },

    async mutate(transformation) {
      return mutateLocalSnapshot(
        RESOURCE_KEY,
        parseCommercialPayload,
        async ({ payload: donnees }) => {
          const mutation = await transformation(
            structuredClone(donnees),
            false,
          );
          const resultat = {
            payload: parseCommercialPayload(
              mutation.payload,
            ),
            focusCaseId: mutation.focusCaseId,
          };
          return {
            payload: resultat.payload,
            result: resultat,
            persist:
              mutation.shouldPersist !== false,
          };
        },
      );
    },
  };
}
