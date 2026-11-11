import "server-only";

import { getCurrentUser } from "@/lib/auth/session";
import { hasModuleAccess, type AccessLevel } from "@/lib/auth/permissions";

export type ModuleRequestContext = {
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
  moduleAccess: {
    canRead: boolean;
    canWrite: boolean;
  };
};

export async function requireModuleRequestContext(
  cleModule: string,
  niveauRequis: AccessLevel,
): Promise<ModuleRequestContext> {
  const utilisateur = await getCurrentUser();
  if (!utilisateur) throw new Error("AUTH_REQUIRED");
  if (utilisateur.mustChangePassword) {
    throw new Error("PASSWORD_CHANGE_REQUIRED");
  }

  const peutEcrire = await hasModuleAccess(utilisateur.id, cleModule, "WRITE");
  const peutLire = peutEcrire || (await hasModuleAccess(utilisateur.id, cleModule, "READ"));

  if (niveauRequis === "WRITE" ? !peutEcrire : !peutLire) {
    throw new Error("MODULE_FORBIDDEN");
  }

  return {
    user: utilisateur,
    moduleAccess: { canRead: peutLire, canWrite: peutEcrire },
  };
}

export function desktopRequestErrorStatus(code: string): number | null {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "PASSWORD_CHANGE_REQUIRED") return 403;
  if (code === "MODULE_FORBIDDEN" || code === "SPECIAL_PERMISSION_FORBIDDEN") {
    return 403;
  }
  return null;
}
