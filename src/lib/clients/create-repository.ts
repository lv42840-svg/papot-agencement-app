import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { ensureClientsPostgresCutover } from "./cutover";
import { acquireNextcloudClientsSnapshot } from "./nextcloud-repository";
import { createPostgresClientsRepository } from "./postgres-repository";
import type { ClientsRepository } from "./repository";

export async function createClientsRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): Promise<ClientsRepository> {
  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  await ensureClientsPostgresCutover({
    pool,
    acquireSource: () =>
      acquireNextcloudClientsSnapshot({
        states: context.desktop.states,
        locks: context.desktop.locks,
        owner: context.owner,
      }),
  });

  return createPostgresClientsRepository(pool);
}
