import "server-only";

import { isLocalStorageMode, mutateLocalSnapshot, readLocalSnapshot } from "../local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "../server-db";
import { parseAuthPayload, pruneExpiredSessions, type AuthPayload } from "./domain";
import { createPostgresAuthRepository, type PostgresAuthRepository } from "./postgres-repository";

const LOCAL_AUTH_RESOURCE = "auth";
let repositoryPromise: Promise<PostgresAuthRepository> | undefined;

async function initializeAuthRepository(): Promise<PostgresAuthRepository> {
  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
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
  if (isLocalStorageMode()) {
    const payload = readLocalSnapshot(LOCAL_AUTH_RESOURCE, parseAuthPayload).payload;
    pruneExpiredSessions(payload);
    return payload;
  }

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

  if (isLocalStorageMode()) {
    return mutateLocalSnapshot(LOCAL_AUTH_RESOURCE, parseAuthPayload, async ({ payload }) => {
      const next = structuredClone(payload);
      pruneExpiredSessions(next);
      const result = await mutate(next);
      return {
        payload: next,
        result: { payload: next, result },
      };
    });
  }

  const repository = await getAuthRepository();
  return repository.mutate(mutate);
}

export async function authHasUsers(): Promise<boolean> {
  return (await readAuthPayload()).users.length > 0;
}
