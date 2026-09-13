import "server-only";

import { db } from "@/lib/db/pool";

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
