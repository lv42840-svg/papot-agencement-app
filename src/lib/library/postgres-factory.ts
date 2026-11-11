import type { ModuleRequestContext } from "@/lib/desktop/request-context";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { createPostgresLibraryRepository } from "./postgres-repository";
import type { LibraryRepository } from "./repository";

export function createPostgresBackedLibraryRepository(
  contexte: ModuleRequestContext,
): LibraryRepository {
  let repositoryPromise: Promise<LibraryRepository> | null = null;

  const initialize = () => {
    repositoryPromise ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      const owner = {
        userId: contexte.user.id,
        deviceId: contexte.user.id,
        displayName: contexte.user.displayName,
      };
      return createPostgresLibraryRepository(owner, pool);
    })();
    return repositoryPromise;
  };

  return {
    async load() {
      return (await initialize()).load();
    },
    async open(leaseId) {
      return (await initialize()).open(leaseId);
    },
    async save(saisie) {
      return (await initialize()).save(saisie);
    },
    async renew(leaseId) {
      return (await initialize()).renew(leaseId);
    },
    async release(leaseId) {
      return (await initialize()).release(leaseId);
    },
  };
}
