import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { createPostgresChantiersRepository } from "./postgres-repository";
import type { ChantiersRepository } from "./repository";

export function createPostgresBackedChantiersRepository(): ChantiersRepository {
  let repositoryPromise: Promise<ChantiersRepository> | null = null;

  const initialize = () => {
    repositoryPromise ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      return createPostgresChantiersRepository(pool);
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
