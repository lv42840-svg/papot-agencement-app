import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { ensureLibraryPostgresCutover } from "./cutover";
import { acquireNextcloudLibrarySnapshot } from "./legacy-snapshot";
import { createPostgresLibraryRepository } from "./postgres-repository";
import type { LibraryRepository } from "./repository";

export function createPostgresBackedLibraryRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): LibraryRepository {
  let repositoryPromise: Promise<LibraryRepository> | null = null;

  const initialize = () => {
    repositoryPromise ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      await ensureLibraryPostgresCutover({
        pool,
        acquireSource: () =>
          acquireNextcloudLibrarySnapshot({
            desktop: context.desktop,
            owner: context.owner,
          }),
      });
      return createPostgresLibraryRepository(context.owner, pool);
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
    async save(input) {
      return (await initialize()).save(input);
    },
    async renew(leaseId) {
      return (await initialize()).renew(leaseId);
    },
    async release(leaseId) {
      return (await initialize()).release(leaseId);
    },
  };
}
