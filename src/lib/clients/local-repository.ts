import "server-only";

import {
  mutateLocalSnapshot,
  readLocalSnapshot,
} from "@/lib/local-db/runtime";
import { parseClientsPayload } from "./domain";
import { applyClientsMutation } from "./mutations";
import type { ClientsRepository } from "./repository";

const RESOURCE_KEY = "clients";

export function createLocalClientsRepository(): ClientsRepository {
  return {
    async load() {
      return readLocalSnapshot(
        RESOURCE_KEY,
        parseClientsPayload,
      ).payload;
    },

    async mutate(saisie, auteur) {
      return mutateLocalSnapshot(
        RESOURCE_KEY,
        parseClientsPayload,
        ({ payload: donnees }) => {
          const mutation = applyClientsMutation(
            structuredClone(donnees),
            saisie,
            auteur,
          );
          return {
            payload: mutation.payload,
            result: mutation,
          };
        },
      );
    },
  };
}
