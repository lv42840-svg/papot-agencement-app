import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { ensureCommercialPostgresCutover } from "./cutover";
import { createLocalCommercialRepository } from "./local-repository";
import { acquireNextcloudCommercialSnapshot } from "./nextcloud-repository";
import { createPostgresCommercialRepository } from "./postgres-repository";
import type { CommercialRepository } from "./repository";

export function createCommercialRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): CommercialRepository {
  if (isLocalStorageMode()) return createLocalCommercialRepository();

  let repositoryPromise: Promise<CommercialRepository> | null = null;

  const initialize = () => {
    repositoryPromise ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      await ensureCommercialPostgresCutover({
        pool,
        acquireSource: () =>
          acquireNextcloudCommercialSnapshot({
            desktop: context.desktop,
            owner: context.owner,
          }),
      });
      return createPostgresCommercialRepository(pool);
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
