import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { ensureChantiersPostgresCutover } from "./cutover";
import { acquireNextcloudChantiersSnapshot } from "./legacy-snapshot";
import { createPostgresChantiersRepository } from "./postgres-repository";
import type { ChantiersRepository } from "./repository";

export function createPostgresBackedChantiersRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): ChantiersRepository {
  let repositoryPromise: Promise<ChantiersRepository> | null = null;

  const initialize = () => {
    repositoryPromise ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      await ensureChantiersPostgresCutover({
        pool,
        acquireSource: () =>
          acquireNextcloudChantiersSnapshot({
            desktop: context.desktop,
            owner: context.owner,
          }),
      });
      return createPostgresChantiersRepository(pool);
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
