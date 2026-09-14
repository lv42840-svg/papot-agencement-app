import "server-only";

import { mutateLocalSnapshot, readLocalSnapshot } from "@/lib/local-db/runtime";
import type { QuotesRepository } from "./repository";
import { parseNativeQuotesPayload } from "./store";

const RESOURCE_KEY = "quotes";

export function createLocalQuotesRepository(): QuotesRepository {
  return {
    async load() {
      return readLocalSnapshot(RESOURCE_KEY, parseNativeQuotesPayload).payload;
    },

    async mutate(transform) {
      return mutateLocalSnapshot(RESOURCE_KEY, parseNativeQuotesPayload, async ({ payload }) => {
        const mutation = await transform(structuredClone(payload));
        const result = {
          payload: parseNativeQuotesPayload(mutation.payload),
          focusQuoteId: mutation.focusQuoteId,
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
