import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db/pool";
import { hashPassword } from "@/lib/auth/password";
import { getCurrentUser } from "@/lib/auth/session";
import {
  MODULE_PERMISSION_CATALOG,
  SPECIAL_PERMISSION_CATALOG,
  type ModulePermissionKey,
  type SpecialPermissionKey,
} from "@/lib/auth/catalog";
import type { AccessLevel } from "@/lib/auth/permissions";

export const createUserSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(320),
  temporaryPassword: z.string().min(12).max(512),
});

export const updateUserSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setActive"), active: z.boolean() }),
  z.object({
    action: z.literal("setIdentity"),
    displayName: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(320),
  }),
  z.object({
    action: z.literal("setPermissions"),
    modules: z.record(z.enum(["NONE", "READ", "WRITE"])),
    specials: z.record(z.boolean()),
  }),
  z.object({
    action: z.literal("forcePasswordReset"),
    temporaryPassword: z.string().min(12).max(512),
  }),
]);

async function requirePermissionAdministrator() {
  const user = await getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  if (!user.canManagePermissions) throw new Error("PERMISSION_ADMIN_FORBIDDEN");
  return user;
}

export async function listUserAdministration() {
  const actor = await requirePermissionAdministrator();
  const [usersResult, modulesResult, specialsResult, sessionsResult] = await Promise.all([
    db.query<{
      id: string;
      display_name: string;
      email: string;
      is_active: boolean;
      can_manage_permissions: boolean;
      must_change_password: boolean;
      created_at: Date;
    }>(
      `SELECT id, display_name, email, is_active, can_manage_permissions,
              must_change_password, created_at
       FROM app_user
       ORDER BY is_active DESC, lower(display_name), lower(email)`,
    ),
    db.query<{ user_id: string; module_key: string; access_level: AccessLevel }>(
      `SELECT user_id, module_key, access_level FROM user_module_permission`,
    ),
    db.query<{ user_id: string; permission_key: string; enabled: boolean }>(
      `SELECT user_id, permission_key, enabled FROM user_special_permission WHERE enabled = true`,
    ),
    db.query<{
      session_id: string;
      user_id: string;
      device_id: string | null;
      device_label: string | null;
      created_at: Date;
      expires_at: Date;
    }>(
      `SELECT session_id, user_id, device_id, device_label, created_at, expires_at
       FROM app_session
       WHERE expires_at > now()
       ORDER BY created_at DESC`,
    ),
  ]);

  const modulesByUser = new Map<string, Record<string, AccessLevel>>();
  for (const row of modulesResult.rows) {
    const value = modulesByUser.get(row.user_id) ?? {};
    value[row.module_key] = row.access_level;
    modulesByUser.set(row.user_id, value);
  }

  const specialsByUser = new Map<string, string[]>();
  for (const row of specialsResult.rows) {
    if (!row.enabled) continue;
    const value = specialsByUser.get(row.user_id) ?? [];
    value.push(row.permission_key);
    specialsByUser.set(row.user_id, value);
  }

  const sessionsByUser = new Map<string, typeof sessionsResult.rows>();
  for (const row of sessionsResult.rows) {
    const value = sessionsByUser.get(row.user_id) ?? [];
    value.push(row);
    sessionsByUser.set(row.user_id, value);
  }

  return {
    actor: { id: actor.id, displayName: actor.displayName },
    moduleCatalog: MODULE_PERMISSION_CATALOG,
    specialCatalog: SPECIAL_PERMISSION_CATALOG,
    futurePermissionNamespaces: ["quotes", "billing"],
    users: usersResult.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      active: row.is_active,
      permissionAdministrator: row.can_manage_permissions,
      mustChangePassword: row.must_change_password,
      createdAt: row.created_at.toISOString(),
      modules: modulesByUser.get(row.id) ?? {},
      specials: specialsByUser.get(row.id) ?? [],
      sessions: (sessionsByUser.get(row.id) ?? []).map((session) => ({
        id: session.session_id,
        deviceId: session.device_id,
        deviceLabel: session.device_label,
        createdAt: session.created_at.toISOString(),
        expiresAt: session.expires_at.toISOString(),
      })),
    })),
  };
}

export async function createManagedUser(input: z.infer<typeof createUserSchema>) {
  await requirePermissionAdministrator();
  const passwordHash = await hashPassword(input.temporaryPassword);
  const id = randomUUID();
  try {
    await db.query(
      `INSERT INTO app_user(
         id, display_name, email, password_hash, is_active,
         can_manage_permissions, must_change_password
       ) VALUES ($1, $2, lower($3), $4, true, false, true)`,
      [id, input.displayName, input.email, passwordHash],
    );
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") throw new Error("USER_EMAIL_ALREADY_EXISTS");
    throw error;
  }
  return { id };
}

function allowedModuleKey(key: string): key is ModulePermissionKey {
  return MODULE_PERMISSION_CATALOG.some((item) => item.key === key);
}

function allowedSpecialKey(key: string): key is SpecialPermissionKey {
  return SPECIAL_PERMISSION_CATALOG.some((item) => item.key === key);
}

export async function updateManagedUser(
  userId: string,
  input: z.infer<typeof updateUserSchema>,
) {
  const actor = await requirePermissionAdministrator();
  const existing = await db.query<{ can_manage_permissions: boolean; is_active: boolean }>(
    `SELECT can_manage_permissions, is_active FROM app_user WHERE id = $1`,
    [userId],
  );
  if (!existing.rows[0]) throw new Error("USER_NOT_FOUND");

  if (input.action === "setActive") {
    if (userId === actor.id && !input.active) throw new Error("ADMIN_SELF_DEACTIVATION_FORBIDDEN");
    await db.query("UPDATE app_user SET is_active = $2, updated_at = now() WHERE id = $1", [
      userId,
      input.active,
    ]);
    if (!input.active) await db.query("DELETE FROM app_session WHERE user_id = $1", [userId]);
    return;
  }

  if (input.action === "setIdentity") {
    try {
      await db.query(
        `UPDATE app_user
         SET display_name = $2, email = lower($3), updated_at = now()
         WHERE id = $1`,
        [userId, input.displayName, input.email],
      );
    } catch (error) {
      if ((error as { code?: string })?.code === "23505") throw new Error("USER_EMAIL_ALREADY_EXISTS");
      throw error;
    }
    return;
  }

  if (input.action === "forcePasswordReset") {
    const passwordHash = await hashPassword(input.temporaryPassword);
    await db.query("BEGIN");
    try {
      await db.query(
        `UPDATE app_user
         SET password_hash = $2, must_change_password = true, updated_at = now()
         WHERE id = $1`,
        [userId, passwordHash],
      );
      await db.query("DELETE FROM app_session WHERE user_id = $1", [userId]);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
    return;
  }

  const modules = Object.entries(input.modules).filter(([key]) => allowedModuleKey(key));
  const specials = Object.entries(input.specials).filter(([key]) => allowedSpecialKey(key));
  await db.query("BEGIN");
  try {
    await db.query("DELETE FROM user_module_permission WHERE user_id = $1", [userId]);
    for (const [moduleKey, level] of modules) {
      if (level === "NONE") continue;
      await db.query(
        `INSERT INTO user_module_permission(user_id, module_key, access_level)
         VALUES ($1, $2, $3)`,
        [userId, moduleKey, level],
      );
    }
    await db.query("DELETE FROM user_special_permission WHERE user_id = $1", [userId]);
    for (const [permissionKey, enabled] of specials) {
      if (!enabled) continue;
      await db.query(
        `INSERT INTO user_special_permission(user_id, permission_key, enabled)
         VALUES ($1, $2, true)`,
        [userId, permissionKey],
      );
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

export async function revokeManagedSession(sessionId: string) {
  const actor = await requirePermissionAdministrator();
  const target = await db.query<{ user_id: string }>(
    "SELECT user_id FROM app_session WHERE session_id = $1",
    [sessionId],
  );
  if (!target.rows[0]) return;
  if (target.rows[0].user_id === actor.id) throw new Error("ADMIN_CURRENT_SESSION_REVOCATION_FORBIDDEN");
  await db.query("DELETE FROM app_session WHERE session_id = $1", [sessionId]);
}
