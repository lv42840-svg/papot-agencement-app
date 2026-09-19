import "server-only";

import { mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import { parseChantiersPayload } from "./domain";
import type { ChantiersRepository } from "./repository";

const RESOURCE_KEY = "chantiers";

export function createLocalChantiersRepository(): ChantiersRepository {
  return {
    async load() {
      return readLocalSnapshot(RESOURCE_KEY, parseChantiersPayload).payload;
    },

    async mutate(transform) {
      return mutateLocalSnapshot(RESOURCE_KEY, parseChantiersPayload, async ({ payload }) => {
        const mutation = await transform(structuredClone(payload), false);
        const result = {
          payload: parseChantiersPayload(mutation.payload),
          focusChantierId: mutation.focusChantierId,
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
