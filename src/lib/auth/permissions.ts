import "server-only";

import type { CurrentUser } from "@/lib/auth/session";
import type { SpecialPermissionKey } from "@/lib/auth/permission-catalog";
import { readAuthPayload, type AccessLevel } from "@/lib/auth/store";

export type { AccessLevel } from "@/lib/auth/store";

export async function hasModuleAccess(userId: string, moduleKey: string, required: AccessLevel) {
  const payload = await readAuthPayload();
  const user = payload.users.find((candidate) => candidate.id === userId && candidate.isActive);
  const access = user?.modulePermissions[moduleKey];
  if (!access) return false;
  if (required === "READ") return true;
  return access === "WRITE";
}

export async function listReadableModules(userId: string): Promise<string[]> {
  const payload = await readAuthPayload();
  const user = payload.users.find((candidate) => candidate.id === userId && candidate.isActive);
  return user ? Object.keys(user.modulePermissions) : [];
}

export async function hasSpecialPermission(userId: string, permissionKey: string) {
  const payload = await readAuthPayload();
  const user = payload.users.find((candidate) => candidate.id === userId && candidate.isActive);
  return user?.specialPermissions.includes(permissionKey) === true;
}

export async function listSpecialPermissions(userId: string): Promise<string[]> {
  const payload = await readAuthPayload();
  const user = payload.users.find((candidate) => candidate.id === userId && candidate.isActive);
  return user ? [...user.specialPermissions].sort() : [];
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
