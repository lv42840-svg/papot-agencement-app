import { readSessionIdentityFromDb, readUserPermissionsFromDb } from "./read-model";
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

export async function readSessionIdentity(hash: string) {
  if (!isLocalStorageMode()) {
    await getAuthRepository();
    return readSessionIdentityFromDb(getServerDbPool(), hash);
  }
  const payload = await readAuthPayload();
  const session = payload.sessions.find(
    (row) => row.tokenHash === hash && Date.parse(row.expiresAt) > Date.now(),
  );
  const user = session && payload.users.find((row) => row.id === session.userId && row.isActive);
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    accentKey: user.accentKey,
    planningPotentialCollapsed: user.planningPotentialCollapsed ?? false,
    canManagePermissions: user.canManagePermissions,
    mustChangePassword: user.mustChangePassword,
  };
}
export async function readUserPermissions(userId: string) {
  if (!isLocalStorageMode()) {
    await getAuthRepository();
    return readUserPermissionsFromDb(getServerDbPool(), userId);
  }
  const user = (await readAuthPayload()).users.find((row) => row.id === userId && row.isActive);
  return user
    ? { modulePermissions: user.modulePermissions, specialPermissions: user.specialPermissions }
    : null;
}
