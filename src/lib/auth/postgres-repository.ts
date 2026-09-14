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

const AUTH_MUTATION_LOCK_ID = 7_332_170_416_238_507;

type AuthQueryable = Pool | PoolClient;

type UserRow = {
  id: string;
  display_name: string;
  email: string;
  password_hash: string;
  is_active: boolean;
  can_manage_permissions: boolean;
  must_change_password: boolean;
  accent_key: string;
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

function isoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rowToUser(row: UserRow): AuthUserRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    passwordHash: row.password_hash,
    isActive: row.is_active,
    canManagePermissions: row.can_manage_permissions,
    mustChangePassword: row.must_change_password,
    accentKey: row.accent_key,
    modulePermissions: row.module_permissions as AuthUserRecord["modulePermissions"],
    specialPermissions: row.special_permissions as AuthUserRecord["specialPermissions"],
  };
}

function rowToSession(row: SessionRow): AuthSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    deviceId: row.device_id,
    deviceLabel: row.device_label,
    createdAt: isoTimestamp(row.created_at),
    expiresAt: isoTimestamp(row.expires_at),
  };
}

async function insertUser(client: PoolClient, user: AuthUserRecord, version: number): Promise<void> {
  await client.query(
    `
      INSERT INTO papot_auth_users (
        id,
        version,
        display_name,
        email,
        password_hash,
        is_active,
        can_manage_permissions,
        must_change_password,
        accent_key,
        module_permissions,
        special_permissions
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
    `,
    [
      user.id,
      version,
      user.displayName,
      user.email,
      user.passwordHash,
      user.isActive,
      user.canManagePermissions,
      user.mustChangePassword,
      user.accentKey,
      JSON.stringify(user.modulePermissions),
      JSON.stringify(user.specialPermissions),
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
      display_name,
      email,
      password_hash,
      is_active,
      can_manage_permissions,
      must_change_password,
      accent_key,
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
  payload: AuthPayload,
): Promise<void> {
  const validated = parseAuthPayload(payload);
  await client.query("DELETE FROM papot_auth_sessions");
  await client.query("DELETE FROM papot_auth_users");

  for (const user of validated.users) {
    await insertUser(client, user, 1);
  }
  for (const session of validated.sessions) {
    await insertSession(client, session);
  }
}

async function replaceMutatedSnapshotOnClient(
  client: PoolClient,
  payload: AuthPayload,
): Promise<void> {
  const validated = parseAuthPayload(payload);
  const versionsResult = await client.query<{ id: string; version: number }>(
    "SELECT id, version FROM papot_auth_users",
  );
  const previousVersions = new Map(versionsResult.rows.map((row) => [row.id, row.version]));

  await client.query("DELETE FROM papot_auth_sessions");
  await client.query("DELETE FROM papot_auth_users");

  for (const user of validated.users) {
    await insertUser(client, user, (previousVersions.get(user.id) ?? 0) + 1);
  }
  for (const session of validated.sessions) {
    await insertSession(client, session);
  }
}

export type PostgresAuthRepository = {
  load(): Promise<AuthPayload>;
  replaceSnapshot(payload: AuthPayload): Promise<void>;
  mutate<T>(
    mutate: (payload: AuthPayload) => T | Promise<T>,
  ): Promise<{ payload: AuthPayload; result: T }>;
};

export function createPostgresAuthRepository(
  pool: Pool = getServerDbPool(),
): PostgresAuthRepository {
  return {
    async load() {
      return loadAuthPayloadFromQueryable(pool);
    },

    async replaceSnapshot(payload) {
      await withServerDbTransaction(async (client) => {
        await replaceAuthSnapshotOnClient(client, payload);
      }, pool);
    },

    async mutate<T>(mutate: (payload: AuthPayload) => T | Promise<T>) {
      return withServerDbTransaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock($1)", [AUTH_MUTATION_LOCK_ID]);
        const payload = await loadAuthPayloadFromQueryable(client);
        pruneExpiredSessions(payload);
        const result = await mutate(payload);
        await replaceMutatedSnapshotOnClient(client, payload);
        return {
          payload: await loadAuthPayloadFromQueryable(client),
          result,
        };
      }, pool);
    },
  };
}
