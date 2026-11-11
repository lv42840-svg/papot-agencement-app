import "server-only";

import { mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import type { QuotesRepository } from "./repository";
import { parseNativeQuotesPayload, type NativeQuotesPayload } from "./store";

const RESOURCE_KEY = "quotes";

export function loadLocalQuotesPayload(): NativeQuotesPayload {
  return readLocalSnapshot(RESOURCE_KEY, parseNativeQuotesPayload).payload;
}

export function createLocalQuotesRepository(): QuotesRepository {
  return {
    async load() {
      return loadLocalQuotesPayload();
    },

    async mutate(transform) {
      return mutateLocalSnapshot(
        RESOURCE_KEY,
        parseNativeQuotesPayload,
        async ({ payload: contenu }) => {
          const mutation = await transform(structuredClone(contenu));
          const resultat = {
            payload: parseNativeQuotesPayload(mutation.payload),
            focusQuoteId: mutation.focusQuoteId,
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
