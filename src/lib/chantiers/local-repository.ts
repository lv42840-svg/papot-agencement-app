import "server-only";

import {
  mutateLocalSnapshot,
  readLocalSnapshot,
} from "@/lib/local-db/runtime";
import { parseChantiersPayload } from "./domain";
import type { ChantiersRepository } from "./repository";

const RESOURCE_KEY = "chantiers";

export function createLocalChantiersRepository(): ChantiersRepository {
  return {
    async load() {
      return readLocalSnapshot(
        RESOURCE_KEY,
        parseChantiersPayload,
      ).payload;
    },

    async mutate(transformation) {
      return mutateLocalSnapshot(
        RESOURCE_KEY,
        parseChantiersPayload,
        async ({ payload: donnees }) => {
          const mutation = await transformation(
            structuredClone(donnees),
            false,
          );
          const resultat = {
            payload: parseChantiersPayload(
              mutation.payload,
            ),
            focusChantierId:
              mutation.focusChantierId,
          };
          return {
            payload: resultat.payload,
            result: resultat,
            persist: mutation.shouldPersist !== false,
          };
        },
      );
    },
  };
}
