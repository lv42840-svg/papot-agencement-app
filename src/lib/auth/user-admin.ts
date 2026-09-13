import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { db } from "@/lib/db/pool";
import { hashPassword } from "@/lib/auth/password";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import type { AccessLevel } from "@/lib/auth/permissions";

export type AdminUserSession = {
  id: string;
  deviceId: string | null;
  deviceLabel: string | null;
  createdAt: string;
  expiresAt: string;
};

export type AdminUserSnapshot = {
  id: string;
  displayName: string;
  email: string;
  isActive: boolean;
  canManagePermissions: boolean;
  mustChangePassword: boolean;
  modulePermissions: Record<string, AccessLevel>;
  specialPermissions: string[];
  sessions: AdminUserSession[];
};

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

export async function requirePermissionAdministrator(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  if (user.mustChangePassword) throw new Error("PASSWORD_CHANGE_REQUIRED");
  if (!user.canManagePermissions) throw new Error("ADMIN_FORBIDDEN");
  return user;
}

export function userAdminErrorStatus(code: string): number {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "PASSWORD_CHANGE_REQUIRED" || code === "ADMIN_FORBIDDEN") return 403;
  if (code === "USER_NOT_FOUND") return 404;
  if (code === "USER_EMAIL_EXISTS") return 409;
  if (code === "CANNOT_DISABLE_SELF") return 409;
  return 400;
}

export async function listAdminUsers(): Promise<AdminUserSnapshot[]> {
  await db.query("DELETE FROM app_session WHERE expires_at <= now()");
  const [usersResult, modulesResult, specialsResult, sessionsResult] = await Promise.all([
    db.query<{
      id: string;
      display_name: string;
      email: string;
      is_active: boolean;
      can_manage_permissions: boolean;
      must_change_password: boolean;
    }>(
      `SELECT id, display_name, email, is_active, can_manage_permissions, must_change_password
       FROM app_user
       ORDER BY is_active DESC, lower(display_name), lower(email)`,
    ),
    db.query<{ user_id: string; module_key: string; access_level: AccessLevel }>(
      "SELECT user_id, module_key, access_level FROM user_module_permission ORDER BY module_key",
    ),
    db.query<{ user_id: string; permission_key: string }>(
      `SELECT user_id, permission_key
       FROM user_special_permission
       WHERE enabled = true
       ORDER BY permission_key`,
    ),
    db.query<{
      session_id: string;
      user_id: string;
      device_id: string | null;
      device_label: string | null;
      created_at: Date | string;
      expires_at: Date | string;
    }>(
      `SELECT session_id, user_id, device_id, device_label, created_at, expires_at
       FROM app_session
       WHERE expires_at > now()
       ORDER BY created_at DESC`,
    ),
  ]);

  const modulesByUser = new Map<string, Record<string, AccessLevel>>();
  for (const row of modulesResult.rows) {
    const current = modulesByUser.get(row.user_id) ?? {};
    current[row.module_key] = row.access_level;
    modulesByUser.set(row.user_id, current);
  }

  const specialsByUser = new Map<string, string[]>();
  for (const row of specialsResult.rows) {
    const current = specialsByUser.get(row.user_id) ?? [];
    current.push(row.permission_key);
    specialsByUser.set(row.user_id, current);
  }

  const sessionsByUser = new Map<string, AdminUserSession[]>();
  for (const row of sessionsResult.rows) {
    const current = sessionsByUser.get(row.user_id) ?? [];
    current.push({
      id: row.session_id,
      deviceId: row.device_id,
      deviceLabel: row.device_label,
      createdAt: iso(row.created_at),
      expiresAt: iso(row.expires_at),
    });
    sessionsByUser.set(row.user_id, current);
  }

  return usersResult.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    isActive: row.is_active,
    canManagePermissions: row.can_manage_permissions,
    mustChangePassword: row.must_change_password,
    modulePermissions: modulesByUser.get(row.id) ?? {},
    specialPermissions: specialsByUser.get(row.id) ?? [],
    sessions: sessionsByUser.get(row.id) ?? [],
  }));
}

async function assertEmailAvailable(client: PoolClient, email: string, exceptUserId?: string) {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM app_user
     WHERE lower(email) = lower($1) AND ($2::uuid IS NULL OR id <> $2::uuid)
     LIMIT 1`,
    [email, exceptUserId ?? null],
  );
  if (result.rowCount) throw new Error("USER_EMAIL_EXISTS");
}

export async function createManagedUser(input: {
  displayName: string;
  email: string;
  temporaryPassword: string;
}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const email = input.email.trim().toLowerCase();
    await assertEmailAvailable(client, email);
    const id = randomUUID();
    const passwordHash = await hashPassword(input.temporaryPassword);
    await client.query(
      `INSERT INTO app_user(
         id, display_name, email, password_hash, is_active, can_manage_permissions,
         must_change_password, updated_at
       ) VALUES ($1, $2, $3, $4, true, false, true, now())`,
      [id, input.displayName.trim(), email, passwordHash],
    );
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateManagedUserProfile(input: {
  userId: string;
  displayName: string;
  email: string;
}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const email = input.email.trim().toLowerCase();
    await assertEmailAvailable(client, email, input.userId);
    const result = await client.query(
      `UPDATE app_user
       SET display_name = $2, email = $3, updated_at = now()
       WHERE id = $1`,
      [input.userId, input.displayName.trim(), email],
    );
    if (!result.rowCount) throw new Error("USER_NOT_FOUND");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function setManagedUserActive(input: {
  userId: string;
  isActive: boolean;
  actorUserId: string;
}) {
  if (!input.isActive && input.userId === input.actorUserId) {
    throw new Error("CANNOT_DISABLE_SELF");
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "UPDATE app_user SET is_active = $2, updated_at = now() WHERE id = $1",
      [input.userId, input.isActive],
    );
    if (!result.rowCount) throw new Error("USER_NOT_FOUND");
    if (!input.isActive) {
      await client.query("DELETE FROM app_session WHERE user_id = $1", [input.userId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function replaceManagedUserPermissions(input: {
  userId: string;
  modules: Array<{ moduleKey: string; accessLevel: AccessLevel }>;
  specialPermissions: string[];
}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query("SELECT 1 FROM app_user WHERE id = $1", [input.userId]);
    if (!user.rowCount) throw new Error("USER_NOT_FOUND");

    await client.query("DELETE FROM user_module_permission WHERE user_id = $1", [input.userId]);
    for (const permission of input.modules) {
      await client.query(
        `INSERT INTO user_module_permission(user_id, module_key, access_level)
         VALUES ($1, $2, $3)`,
        [input.userId, permission.moduleKey, permission.accessLevel],
      );
    }

    await client.query("DELETE FROM user_special_permission WHERE user_id = $1", [input.userId]);
    for (const permissionKey of input.specialPermissions) {
      await client.query(
        `INSERT INTO user_special_permission(user_id, permission_key, enabled)
         VALUES ($1, $2, true)`,
        [input.userId, permissionKey],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function resetManagedUserPassword(input: {
  userId: string;
  temporaryPassword: string;
}) {
  const passwordHash = await hashPassword(input.temporaryPassword);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE app_user
       SET password_hash = $2, must_change_password = true, updated_at = now()
       WHERE id = $1`,
      [input.userId, passwordHash],
    );
    if (!result.rowCount) throw new Error("USER_NOT_FOUND");
    await client.query("DELETE FROM app_session WHERE user_id = $1", [input.userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeManagedUserSession(input: { userId: string; sessionId: string }) {
  await db.query("DELETE FROM app_session WHERE user_id = $1 AND session_id = $2", [
    input.userId,
    input.sessionId,
  ]);
}
