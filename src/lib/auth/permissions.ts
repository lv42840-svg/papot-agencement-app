import "server-only";

import { db } from "@/lib/db/pool";
import type { CurrentUser } from "@/lib/auth/session";
import type { SpecialPermissionKey } from "@/lib/auth/permission-catalog";

export type AccessLevel = "READ" | "WRITE";

export async function hasModuleAccess(userId: string, moduleKey: string, required: AccessLevel) {
  const result = await db.query<{ access_level: AccessLevel }>(
    "SELECT access_level FROM user_module_permission WHERE user_id = $1 AND module_key = $2",
    [userId, moduleKey],
  );
  const access = result.rows[0]?.access_level;
  if (!access) return false;
  if (required === "READ") return true;
  return access === "WRITE";
}

export async function listReadableModules(userId: string): Promise<string[]> {
  const result = await db.query<{ module_key: string }>(
    "SELECT module_key FROM user_module_permission WHERE user_id = $1",
    [userId],
  );
  return result.rows.map((row) => row.module_key);
}

export async function hasSpecialPermission(userId: string, permissionKey: string) {
  const result = await db.query<{ enabled: boolean }>(
    "SELECT enabled FROM user_special_permission WHERE user_id = $1 AND permission_key = $2",
    [userId, permissionKey],
  );
  return result.rows[0]?.enabled === true;
}

export async function listSpecialPermissions(userId: string): Promise<string[]> {
  const result = await db.query<{ permission_key: string }>(
    `SELECT permission_key
     FROM user_special_permission
     WHERE user_id = $1 AND enabled = true
     ORDER BY permission_key`,
    [userId],
  );
  return result.rows.map((row) => row.permission_key);
}

export async function hasEffectiveSpecialPermission(
  user: Pick<CurrentUser, "id">,
  permissionKey: SpecialPermissionKey,
) {
  return hasSpecialPermission(user.id, permissionKey);
}

export async function requireSpecialPermission(
  user: Pick<CurrentUser, "id">,
  permissionKey: SpecialPermissionKey,
) {
  if (!(await hasEffectiveSpecialPermission(user, permissionKey))) {
    throw new Error("SPECIAL_PERMISSION_FORBIDDEN");
  }
}
