import "server-only";

import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { createLocalPlanningRepository } from "./local-repository";
import { createPostgresPlanningRepository } from "./postgres-repository";
import type { PlanningRepository } from "./repository";

export function createPlanningRepository(): PlanningRepository {
  if (isLocalStorageMode()) return createLocalPlanningRepository();

  let repositoryPromise: Promise<PlanningRepository> | null = null;
  const initialize = () => {
    repositoryPromise ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      return createPostgresPlanningRepository(pool);
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
