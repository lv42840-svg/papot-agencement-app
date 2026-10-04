import type {
  DesktopRequestContext,
  ModuleRequestContext,
} from "@/lib/desktop/request-context";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { ensureChantiersPostgresCutover } from "./cutover";
import { acquireNextcloudChantiersSnapshot } from "./legacy-snapshot";
import { createPostgresChantiersRepository } from "./postgres-repository";
import type { ChantiersRepository } from "./repository";

type PostgresChantiersContext =
  | Pick<DesktopRequestContext, "desktop" | "owner">
  | ModuleRequestContext;

export function createPostgresBackedChantiersRepository(
  context: PostgresChantiersContext,
): ChantiersRepository {
  let repositoryPromise: Promise<ChantiersRepository> | null = null;

  const initialize = () => {
    repositoryPromise ??= (async () => {
      const pool = getServerDbPool();
      await runServerDbMigrations(pool);
      await ensureChantiersPostgresCutover({
        pool,
        acquireSource: () => {
          if (!("desktop" in context)) {
            throw new Error("CHANTIERS_LEGACY_CUTOVER_CONTEXT_REQUIRED");
          }
          return acquireNextcloudChantiersSnapshot({
            desktop: context.desktop,
            owner: context.owner,
          });
        },
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
