import { readSessionIdentityFromDb, readUserPermissionsFromDb } from "./read-model";
import "server-only";

import {
  isLocalStorageMode,
  mutateLocalSnapshot,
  readLocalSnapshot,
} from "../local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "../server-db";
import { parseAuthPayload, pruneExpiredSessions, type AuthPayload } from "./domain";
import {
  createPostgresAuthRepository,
  type PostgresAuthRepository,
} from "./postgres-repository";

const LOCAL_AUTH_RESOURCE = "auth";
let repositoryPromise: Promise<PostgresAuthRepository> | undefined;

async function initializeAuthRepository(): Promise<PostgresAuthRepository> {
  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  return createPostgresAuthRepository(pool);
}

async function getAuthRepository(): Promise<PostgresAuthRepository> {
  if (!repositoryPromise) {
    repositoryPromise = initializeAuthRepository().catch((erreur: unknown) => {
      repositoryPromise = undefined;
      throw erreur;
    });
  }
  return repositoryPromise;
}

export async function readAuthPayload(): Promise<AuthPayload> {
  if (isLocalStorageMode()) {
    const donnees = readLocalSnapshot(LOCAL_AUTH_RESOURCE, parseAuthPayload).payload;
    pruneExpiredSessions(donnees);
    return donnees;
  }

  const depot = await getAuthRepository();
  const donnees = await depot.load();
  pruneExpiredSessions(donnees);
  return donnees;
}

export async function mutateAuthPayload<T>(
  idUtilisateurAuteur: string,
  modifier: (donnees: AuthPayload) => T | Promise<T>,
): Promise<{ payload: AuthPayload; result: T }> {
  void idUtilisateurAuteur;

  if (isLocalStorageMode()) {
    return mutateLocalSnapshot(
      LOCAL_AUTH_RESOURCE,
      parseAuthPayload,
      async ({ payload: donnees }) => {
        const donneesSuivantes = structuredClone(donnees);
        pruneExpiredSessions(donneesSuivantes);
        const resultat = await modifier(donneesSuivantes);
        return {
          payload: donneesSuivantes,
          result: { payload: donneesSuivantes, result: resultat },
        };
      },
    );
  }

  const depot = await getAuthRepository();
  return depot.mutate(modifier);
}

export async function authHasUsers(): Promise<boolean> {
  return (await readAuthPayload()).users.length > 0;
}

export async function readSessionIdentity(empreinte: string) {
  if (!isLocalStorageMode()) {
    await getAuthRepository();
    return readSessionIdentityFromDb(getServerDbPool(), empreinte);
  }
  const donnees = await readAuthPayload();
  const session = donnees.sessions.find(
    (ligne) =>
      ligne.tokenHash === empreinte && Date.parse(ligne.expiresAt) > Date.now(),
  );
  const utilisateur =
    session &&
    donnees.users.find(
      (ligne) => ligne.id === session.userId && ligne.isActive,
    );
  if (!utilisateur) return null;
  return {
    id: utilisateur.id,
    username: utilisateur.username,
    displayName: utilisateur.displayName,
    email: utilisateur.email,
    accentKey: utilisateur.accentKey,
    planningPotentialCollapsed: utilisateur.planningPotentialCollapsed ?? false,
    canManagePermissions: utilisateur.canManagePermissions,
    mustChangePassword: utilisateur.mustChangePassword,
  };
}
export async function readUserPermissions(idUtilisateur: string) {
  if (!isLocalStorageMode()) {
    await getAuthRepository();
    return readUserPermissionsFromDb(getServerDbPool(), idUtilisateur);
  }
  const utilisateur = (await readAuthPayload()).users.find(
    (ligne) => ligne.id === idUtilisateur && ligne.isActive,
  );
  return utilisateur
    ? {
        modulePermissions: utilisateur.modulePermissions,
        specialPermissions: utilisateur.specialPermissions,
      }
    : null;
}
