import "server-only";

import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { createLocalCompanyProfileRepository } from "./local-repository";
import { createPostgresCompanyProfileRepository } from "./postgres-repository";
import type { CompanyProfileRepository } from "./repository";

export function createCompanyProfileRepository(): CompanyProfileRepository {
  if (isLocalStorageMode()) return createLocalCompanyProfileRepository();

  let promesseDepot: Promise<CompanyProfileRepository> | null = null;
  const initialiser = () => {
    promesseDepot ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      return createPostgresCompanyProfileRepository(pool);
    })();
    return promesseDepot;
  };

  return {
    async load() {
      return (await initialiser()).load();
    },
    async replace(profil) {
      return (await initialiser()).replace(profil);
    },
  };
}
