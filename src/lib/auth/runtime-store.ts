import "server-only";

import { createDesktopSharedResourceRuntime } from "../desktop/shared-resource-runtime";
import { getServerDbPool, runServerDbMigrations } from "../server-db";
import { ensureAuthPostgresCutover } from "./cutover";
import { pruneExpiredSessions, type AuthPayload } from "./domain";
import { acquireNextcloudAuthSnapshot } from "./nextcloud-source";
import {
  createPostgresAuthRepository,
  type PostgresAuthRepository,
} from "./postgres-repository";

let repositoryPromise: Promise<PostgresAuthRepository> | undefined;

async function initializeAuthRepository(): Promise<PostgresAuthRepository> {
  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  await ensureAuthPostgresCutover({
    pool,
    acquireSource: async () => {
      const desktop = createDesktopSharedResourceRuntime();
      return acquireNextcloudAuthSnapshot({
        states: desktop.states,
        locks: desktop.locks,
        owner: {
          userId: desktop.nextcloudUserId,
          deviceId: desktop.deviceId,
          displayName: "PAPOT Auth cutover",
        },
      });
    },
  });
  return createPostgresAuthRepository(pool);
}

async function getAuthRepository(): Promise<PostgresAuthRepository> {
  if (!repositoryPromise) {
    repositoryPromise = initializeAuthRepository().catch((error: unknown) => {
      repositoryPromise = undefined;
      throw error;
    });
  }
  return repositoryPromise;
}

export async function readAuthPayload(): Promise<AuthPayload> {
  const repository = await getAuthRepository();
  const payload = await repository.load();
  pruneExpiredSessions(payload);
  return payload;
}

export async function mutateAuthPayload<T>(
  actorUserId: string,
  mutate: (payload: AuthPayload) => T | Promise<T>,
): Promise<{ payload: AuthPayload; result: T }> {
  void actorUserId;
  const repository = await getAuthRepository();
  return repository.mutate(mutate);
}

export async function authHasUsers(): Promise<boolean> {
  return (await readAuthPayload()).users.length > 0;
}
