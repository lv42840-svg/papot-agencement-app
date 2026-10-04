import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { createLocalCommercialRepository } from "./local-repository";
import { createPostgresCommercialRepository } from "./postgres-repository";
import type { CommercialRepository } from "./repository";

export function createCommercialRepository(): CommercialRepository {
  if (isLocalStorageMode()) return createLocalCommercialRepository();

  let repositoryPromise: Promise<CommercialRepository> | null = null;

  const initialize = () => {
    repositoryPromise ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      return createPostgresCommercialRepository(pool);
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
