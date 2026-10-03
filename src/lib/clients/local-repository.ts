import "server-only";

import { mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import { parseClientsPayload } from "./domain";
import { applyClientsMutation } from "./mutations";
import type { ClientsRepository } from "./repository";

const RESOURCE_KEY = "clients";

export function createLocalClientsRepository(): ClientsRepository {
  return {
    async load() {
      return readLocalSnapshot(RESOURCE_KEY, parseClientsPayload).payload;
    },

    async mutate(input, actor) {
      return mutateLocalSnapshot(RESOURCE_KEY, parseClientsPayload, ({ payload }) => {
        const mutation = applyClientsMutation(structuredClone(payload), input, actor);
        return {
          payload: mutation.payload,
          result: mutation,
        };
      });
    },
  };
}
