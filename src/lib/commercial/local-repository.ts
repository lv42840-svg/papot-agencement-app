import "server-only";

import { mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import { parseCommercialPayload } from "./domain";
import type { CommercialRepository } from "./repository";

const RESOURCE_KEY = "commercial";

export function createLocalCommercialRepository(): CommercialRepository {
  return {
    async load() {
      return readLocalSnapshot(RESOURCE_KEY, parseCommercialPayload).payload;
    },

    async mutate(transform) {
      return mutateLocalSnapshot(RESOURCE_KEY, parseCommercialPayload, async ({ payload }) => {
        const mutation = await transform(structuredClone(payload), false);
        const result = {
          payload: parseCommercialPayload(mutation.payload),
          focusCaseId: mutation.focusCaseId,
        };
        return {
          payload: result.payload,
          result,
          persist: mutation.shouldPersist !== false,
        };
      });
    },
  };
}
