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
  moduleKey: string,
  required: AccessLevel,
): Promise<ModuleRequestContext> {
  const user = await getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  if (user.mustChangePassword) throw new Error("PASSWORD_CHANGE_REQUIRED");

  const canWrite = await hasModuleAccess(user.id, moduleKey, "WRITE");
  const canRead = canWrite || (await hasModuleAccess(user.id, moduleKey, "READ"));

  if (required === "WRITE" ? !canWrite : !canRead) {
    throw new Error("MODULE_FORBIDDEN");
  }

  return {
    user,
    moduleAccess: { canRead, canWrite },
  };
}

export function desktopRequestErrorStatus(code: string): number | null {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "PASSWORD_CHANGE_REQUIRED") return 403;
  if (code === "MODULE_FORBIDDEN" || code === "SPECIAL_PERMISSION_FORBIDDEN") return 403;
  return null;
}
