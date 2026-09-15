import "server-only";

import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { createLocalQuotesRepository } from "./local-repository";
import { normalizeQuotePricingAfterModelMutation } from "./pricing-integrity";
import type { QuotesRepository } from "./repository";

export function createQuotesRepository(): QuotesRepository {
  if (!isLocalStorageMode()) throw new Error("QUOTES_SERVER_REPOSITORY_NOT_IMPLEMENTED");

  const repository = createLocalQuotesRepository();
  return {
    load: () => repository.load(),
    mutate: (transform) =>
      repository.mutate(async (payload) => {
        const mutation = await transform(payload);
        return {
          ...mutation,
          payload: normalizeQuotePricingAfterModelMutation(mutation.payload, mutation.focusQuoteId),
        };
      }),
  };
}
