import "server-only";

import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { createLocalPlanningRepository } from "./local-repository";
import { createPostgresPlanningRepository } from "./postgres-repository";
import type { PlanningRepository } from "./repository";

export function createPlanningRepository(): PlanningRepository {
  if (isLocalStorageMode()) {
    return createLocalPlanningRepository();
  }

  let promesseDepot: Promise<PlanningRepository> | null = null;
  const initialiser = () => {
    promesseDepot ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      return createPostgresPlanningRepository(pool);
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
