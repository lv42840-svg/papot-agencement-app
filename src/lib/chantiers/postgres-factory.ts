import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { createPostgresChantiersRepository } from "./postgres-repository";
import type { ChantiersRepository } from "./repository";

export function createPostgresBackedChantiersRepository(): ChantiersRepository {
  let promesseDepot: Promise<ChantiersRepository> | null = null;

  const initialiser = () => {
    promesseDepot ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      return createPostgresChantiersRepository(pool);
    })();
    return promesseDepot;
  };

  return {
    async load() {
      return (await initialiser()).load();
    },
    async mutate(transformation) {
      return (await initialiser()).mutate(transformation);
    },
  };
}
