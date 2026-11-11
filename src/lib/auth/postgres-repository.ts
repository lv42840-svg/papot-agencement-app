import "server-only";

import type { Pool, PoolClient } from "pg";

import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import {
  parseAuthPayload,
  pruneExpiredSessions,
  type AuthPayload,
  type AuthSessionRecord,
  type AuthUserRecord,
} from "./domain";

import { lockAuthMutation } from "./transaction-lock";

type AuthQueryable = Pool | PoolClient;

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  email: string;
  password_hash: string;
  is_active: boolean;
  can_manage_permissions: boolean;
  must_change_password: boolean;
  accent_key: string;
  planning_potential_collapsed: boolean;
  module_permissions: unknown;
  special_permissions: unknown;
};

type SessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  device_id: string | null;
  device_label: string | null;
  created_at: Date | string;
  expires_at: Date | string;
};

function isoTimestamp(valeur: Date | string): string {
  return valeur instanceof Date ? valeur.toISOString() : new Date(valeur).toISOString();
}

function rowToUser(ligneTableau: UserRow): AuthUserRecord {
  return {
    id: ligneTableau.id,
    username: ligneTableau.username,
    displayName: ligneTableau.display_name,
    email: ligneTableau.email,
    passwordHash: ligneTableau.password_hash,
    isActive: ligneTableau.is_active,
    canManagePermissions: ligneTableau.can_manage_permissions,
    mustChangePassword: ligneTableau.must_change_password,
    accentKey: ligneTableau.accent_key,
    planningPotentialCollapsed: ligneTableau.planning_potential_collapsed || undefined,
    modulePermissions: ligneTableau.module_permissions as AuthUserRecord["modulePermissions"],
    specialPermissions: ligneTableau.special_permissions as AuthUserRecord["specialPermissions"],
  };
}

function rowToSession(ligneTableau: SessionRow): AuthSessionRecord {
  return {
    id: ligneTableau.id,
    userId: ligneTableau.user_id,
    tokenHash: ligneTableau.token_hash,
    deviceId: ligneTableau.device_id,
    deviceLabel: ligneTableau.device_label,
    createdAt: isoTimestamp(ligneTableau.created_at),
    expiresAt: isoTimestamp(ligneTableau.expires_at),
  };
}

async function insertUser(
  client: PoolClient,
  utilisateur: AuthUserRecord,
  version: number,
): Promise<void> {
  await client.query(
    `
      INSERT INTO papot_auth_users (
        id,
        version,
        username,
        display_name,
        email,
        password_hash,
        is_active,
        can_manage_permissions,
        must_change_password,
        accent_key,
        planning_potential_collapsed,
        module_permissions,
        special_permissions
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)
    `,
    [
      utilisateur.id,
      version,
      utilisateur.username,
      utilisateur.displayName,
      utilisateur.email,
      utilisateur.passwordHash,
      utilisateur.isActive,
      utilisateur.canManagePermissions,
      utilisateur.mustChangePassword,
      utilisateur.accentKey,
      utilisateur.planningPotentialCollapsed ?? false,
      JSON.stringify(utilisateur.modulePermissions),
      JSON.stringify(utilisateur.specialPermissions),
    ],
  );
}

async function upsertUser(
  client: PoolClient,
  utilisateur: AuthUserRecord,
  version: number,
): Promise<void> {
  await client.query(
    `
      INSERT INTO papot_auth_users (
        id,
        version,
        username,
        display_name,
        email,
        password_hash,
        is_active,
        can_manage_permissions,
        must_change_password,
        accent_key,
        planning_potential_collapsed,
        module_permissions,
        special_permissions
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        version = EXCLUDED.version,
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        email = EXCLUDED.email,
        password_hash = EXCLUDED.password_hash,
        is_active = EXCLUDED.is_active,
        can_manage_permissions = EXCLUDED.can_manage_permissions,
        must_change_password = EXCLUDED.must_change_password,
        accent_key = EXCLUDED.accent_key,
        planning_potential_collapsed = EXCLUDED.planning_potential_collapsed,
        module_permissions = EXCLUDED.module_permissions,
        special_permissions = EXCLUDED.special_permissions
    `,
    [
      utilisateur.id,
      version,
      utilisateur.username,
      utilisateur.displayName,
      utilisateur.email,
      utilisateur.passwordHash,
      utilisateur.isActive,
      utilisateur.canManagePermissions,
      utilisateur.mustChangePassword,
      utilisateur.accentKey,
      utilisateur.planningPotentialCollapsed ?? false,
      JSON.stringify(utilisateur.modulePermissions),
      JSON.stringify(utilisateur.specialPermissions),
    ],
  );
}

async function insertSession(client: PoolClient, session: AuthSessionRecord): Promise<void> {
  await client.query(
    `
      INSERT INTO papot_auth_sessions (
        id,
        user_id,
        token_hash,
        device_id,
        device_label,
        created_at,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    [
      session.id,
      session.userId,
      session.tokenHash,
      session.deviceId,
      session.deviceLabel,
      session.createdAt,
      session.expiresAt,
    ],
  );
}

export async function loadAuthPayloadFromQueryable(queryable: AuthQueryable): Promise<AuthPayload> {
  const usersResult = await queryable.query<UserRow>(`
    SELECT
      id,
      username,
      display_name,
      email,
      password_hash,
      is_active,
      can_manage_permissions,
      must_change_password,
      accent_key,
      planning_potential_collapsed,
      module_permissions,
      special_permissions
    FROM papot_auth_users
    ORDER BY id ASC
  `);
  const sessionsResult = await queryable.query<SessionRow>(`
    SELECT
      id,
      user_id,
      token_hash,
      device_id,
      device_label,
      created_at,
      expires_at
    FROM papot_auth_sessions
    ORDER BY created_at ASC, id ASC
  `);

  return parseAuthPayload({
    schemaVersion: 1,
    users: usersResult.rows.map(rowToUser),
    sessions: sessionsResult.rows.map(rowToSession),
  });
}

export async function replaceAuthSnapshotOnClient(
  client: PoolClient,
  contenu: AuthPayload,
): Promise<void> {
  const validated = parseAuthPayload(contenu);
  await client.query("DELETE FROM papot_auth_sessions");
  await client.query("DELETE FROM papot_auth_users");

  for (const utilisateur of validated.users) {
    await insertUser(client, utilisateur, 1);
  }
  for (const session of validated.sessions) {
    await insertSession(client, session);
  }
}

async function replaceMutatedSnapshotOnClient(
  client: PoolClient,
  contenu: AuthPayload,
): Promise<void> {
  const validated = parseAuthPayload(contenu);
  const versionsResult = await client.query<{ id: string; version: number }>(
    "SELECT id, version FROM papot_auth_users",
  );
  const previousVersions = new Map(
    versionsResult.rows.map((ligneTableau) => [ligneTableau.id, ligneTableau.version]),
  );

  await client.query("DELETE FROM papot_auth_sessions");

  for (const utilisateur of validated.users) {
    await upsertUser(client, utilisateur, (previousVersions.get(utilisateur.id) ?? 0) + 1);
  }

  if (validated.users.length === 0) {
    await client.query("DELETE FROM papot_auth_users");
  } else {
    await client.query("DELETE FROM papot_auth_users WHERE NOT (id = ANY($1::uuid[]))", [
      validated.users.map((utilisateur) => utilisateur.id),
    ]);
  }

  for (const session of validated.sessions) {
    await insertSession(client, session);
  }
}

export type PostgresAuthRepository = {
  load(): Promise<AuthPayload>;
  replaceSnapshot(contenu: AuthPayload): Promise<void>;
  mutate<T>(
    mutate: (contenu: AuthPayload) => T | Promise<T>,
  ): Promise<{ payload: AuthPayload; result: T }>;
};

export function createPostgresAuthRepository(
  pool: Pool = getServerDbPool(),
): PostgresAuthRepository {
  return {
    async load() {
      return loadAuthPayloadFromQueryable(pool);
    },

    async replaceSnapshot(contenu) {
      await withServerDbTransaction(async (client) => {
        await lockAuthMutation(client);
        await replaceAuthSnapshotOnClient(client, contenu);
      }, pool);
    },

    async mutate<T>(mutate: (contenu: AuthPayload) => T | Promise<T>) {
      return withServerDbTransaction(async (client) => {
        await lockAuthMutation(client);
        const contenu = await loadAuthPayloadFromQueryable(client);
        pruneExpiredSessions(contenu);
        const resultat = await mutate(contenu);
        await replaceMutatedSnapshotOnClient(client, contenu);
        return {
          payload: await loadAuthPayloadFromQueryable(client),
          result: resultat,
        };
      }, pool);
    },
  };
}
