import "server-only";

import type { CurrentUser } from "@/lib/auth/session";
import type { SpecialPermissionKey } from "@/lib/auth/permission-catalog";
import { readUserPermissions, type AccessLevel } from "@/lib/auth/store";

export type { AccessLevel } from "@/lib/auth/store";

export async function hasModuleAccess(
  idUtilisateur: string,
  cleModule: string,
  niveauRequis: AccessLevel,
) {
  const utilisateur = await readUserPermissions(idUtilisateur);
  const acces = utilisateur?.modulePermissions[cleModule];
  if (!acces) return false;
  if (niveauRequis === "READ") return true;
  return acces === "WRITE";
}

export async function listReadableModules(idUtilisateur: string): Promise<string[]> {
  const utilisateur = await readUserPermissions(idUtilisateur);
  return utilisateur ? Object.keys(utilisateur.modulePermissions) : [];
}

export async function hasSpecialPermission(idUtilisateur: string, clePermission: string) {
  const utilisateur = await readUserPermissions(idUtilisateur);
  return utilisateur?.specialPermissions.includes(clePermission) === true;
}

export async function listSpecialPermissions(idUtilisateur: string): Promise<string[]> {
  const utilisateur = await readUserPermissions(idUtilisateur);
  return utilisateur ? [...utilisateur.specialPermissions].sort() : [];
}

export async function hasEffectiveSpecialPermission(
  utilisateur: Pick<CurrentUser, "id">,
  clePermission: SpecialPermissionKey,
) {
  return hasSpecialPermission(utilisateur.id, clePermission);
}

export async function requireSpecialPermission(
  utilisateur: Pick<CurrentUser, "id">,
  clePermission: SpecialPermissionKey,
) {
  if (!(await hasEffectiveSpecialPermission(utilisateur, clePermission))) {
    throw new Error("SPECIAL_PERMISSION_FORBIDDEN");
  }
}
