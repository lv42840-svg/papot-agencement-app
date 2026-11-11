import { isLocalStorageMode } from "@/lib/local-db/runtime";
import {
  getServerDbPool,
  runServerDbMigrations,
} from "@/lib/server-db";
import { createLocalCommercialRepository } from "./local-repository";
import { createPostgresCommercialRepository } from "./postgres-repository";
import type { CommercialRepository } from "./repository";

export function createCommercialRepository(): CommercialRepository {
  if (isLocalStorageMode()) {
    return createLocalCommercialRepository();
  }

  let promesseDepot: Promise<CommercialRepository> | null =
    null;

  const initialiser = () => {
    promesseDepot ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      return createPostgresCommercialRepository(pool);
    })();
    return promesseDepot;
  };

  return {
    async load() {
      return (await initialiser()).load();
    },
    async mutate(transformation) {
      return (await initialiser()).mutate(
        transformation,
      );
    },
  };
}
