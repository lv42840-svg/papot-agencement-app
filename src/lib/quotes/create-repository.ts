import "server-only";

import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { ensureQuotesPostgresCutover } from "./cutover";
import { createLocalQuotesRepository, loadLocalQuotesPayload } from "./local-repository";
import { createPostgresQuotesRepository } from "./postgres-repository";
import { normalizeQuotePricingAfterModelMutation } from "./pricing-integrity";
import type { QuotesRepository } from "./repository";

function normalizedRepository(repository: QuotesRepository): QuotesRepository {
  return {
    load: () => repository.load(),
    mutate: (transform) =>
      repository.mutate(async (contenu) => {
        const mutation = await transform(contenu);
        return {
          ...mutation,
          payload: mutation.focusQuoteId
            ? normalizeQuotePricingAfterModelMutation(mutation.payload, mutation.focusQuoteId)
            : mutation.payload,
        };
      }),
  };
}

export function createQuotesRepository(): QuotesRepository {
  if (isLocalStorageMode()) return normalizedRepository(createLocalQuotesRepository());

  let repositoryPromise: Promise<QuotesRepository> | null = null;
  const initialize = () => {
    repositoryPromise ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      await ensureQuotesPostgresCutover({
        pool,
        acquireSource: async () => loadLocalQuotesPayload(),
      });
      return normalizedRepository(createPostgresQuotesRepository(pool));
    })();
    return repositoryPromise;
  };

  return {
    async load() {
      return (await initialize()).load();
    },
    async mutate(transform) {
      return (await initialize()).mutate(transform);
    },
  };
}
