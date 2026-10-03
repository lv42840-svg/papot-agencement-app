import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { ensureEntriesPostgresCutover } from "./cutover";
import { createLocalEntriesRepository } from "./local-repository";
import { acquireNextcloudEntriesSnapshot } from "./nextcloud-repository";
import { createPostgresEntriesRepository } from "./postgres-repository";
import type { EntriesRepository } from "./repository";

type LegacyEntriesCutoverContext = Pick<DesktopRequestContext, "desktop" | "owner">;

export async function createEntriesRepository(
  context?: LegacyEntriesCutoverContext,
): Promise<EntriesRepository> {
  if (isLocalStorageMode()) return createLocalEntriesRepository();

  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  await ensureEntriesPostgresCutover({
    pool,
    acquireSource: () => {
      if (!context) throw new Error("ENTRIES_LEGACY_CUTOVER_CONTEXT_REQUIRED");
      return acquireNextcloudEntriesSnapshot({
        desktop: context.desktop,
        owner: context.owner,
      });
    },
  });

  return createPostgresEntriesRepository(pool);
}
