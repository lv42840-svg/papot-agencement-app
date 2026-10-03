import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { ensureClientsPostgresCutover } from "./cutover";
import { createLocalClientsRepository } from "./local-repository";
import { acquireNextcloudClientsSnapshot } from "./nextcloud-repository";
import { createPostgresClientsRepository } from "./postgres-repository";
import type { ClientsRepository } from "./repository";

type LegacyClientsCutoverContext = Pick<DesktopRequestContext, "desktop" | "owner">;

export async function createClientsRepository(
  context?: LegacyClientsCutoverContext,
): Promise<ClientsRepository> {
  if (isLocalStorageMode()) return createLocalClientsRepository();

  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  await ensureClientsPostgresCutover({
    pool,
    acquireSource: () => {
      if (!context) throw new Error("CLIENTS_LEGACY_CUTOVER_CONTEXT_REQUIRED");
      return acquireNextcloudClientsSnapshot({
        states: context.desktop.states,
        locks: context.desktop.locks,
        owner: context.owner,
      });
    },
  });

  return createPostgresClientsRepository(pool);
}
