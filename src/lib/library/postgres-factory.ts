import type { DesktopRequestContext, ModuleRequestContext } from "@/lib/desktop/request-context";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { ensureLibraryPostgresCutover } from "./cutover";
import { acquireNextcloudLibrarySnapshot } from "./legacy-snapshot";
import { createPostgresLibraryRepository } from "./postgres-repository";
import type { LibraryRepository } from "./repository";

type PostgresLibraryContext =
  | Pick<DesktopRequestContext, "desktop" | "owner">
  | ModuleRequestContext;

export function createPostgresBackedLibraryRepository(
  context: PostgresLibraryContext,
): LibraryRepository {
  let repositoryPromise: Promise<LibraryRepository> | null = null;

  const initialize = () => {
    repositoryPromise ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      await ensureLibraryPostgresCutover({
        pool,
        acquireSource: () => {
          if (!("desktop" in context)) {
            throw new Error("LIBRARY_LEGACY_CUTOVER_CONTEXT_REQUIRED");
          }
          return acquireNextcloudLibrarySnapshot({
            desktop: context.desktop,
            owner: context.owner,
          });
        },
      });
      const owner =
        "owner" in context
          ? context.owner
          : {
              userId: context.user.id,
              deviceId: "web",
              displayName: context.user.displayName,
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
