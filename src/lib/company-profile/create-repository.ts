import "server-only";

import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { createLocalCompanyProfileRepository } from "./local-repository";
import { createPostgresCompanyProfileRepository } from "./postgres-repository";
import type { CompanyProfileRepository } from "./repository";

export function createCompanyProfileRepository(): CompanyProfileRepository {
  if (isLocalStorageMode()) return createLocalCompanyProfileRepository();

  let repositoryPromise: Promise<CompanyProfileRepository> | null = null;
  const initialize = () => {
    repositoryPromise ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      return createPostgresCompanyProfileRepository(pool);
    })();
    return repositoryPromise;
  };

  return {
    async load() {
      return (await initialize()).load();
    },
    async replace(profile) {
      return (await initialize()).replace(profile);
    },
  };
}
