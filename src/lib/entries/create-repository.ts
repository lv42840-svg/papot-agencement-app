import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { ensureEntriesPostgresCutover } from "./cutover";
import { acquireNextcloudEntriesSnapshot } from "./nextcloud-repository";
import { createPostgresEntriesRepository } from "./postgres-repository";
import type { EntriesRepository } from "./repository";

export async function createEntriesRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): Promise<EntriesRepository> {
  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  await ensureEntriesPostgresCutover({
    pool,
    acquireSource: () =>
      acquireNextcloudEntriesSnapshot({
        desktop: context.desktop,
        owner: context.owner,
      }),
  });

  return createPostgresEntriesRepository(pool);
}
