import "server-only";

import { getCurrentUser } from "@/lib/auth/session";
import { hasModuleAccess, type AccessLevel } from "@/lib/auth/permissions";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";

export type ModuleRequestContext = {
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
  moduleAccess: {
    canRead: boolean;
    canWrite: boolean;
  };
};

export type DesktopRequestContext = ModuleRequestContext & {
  desktop: ReturnType<typeof createDesktopSharedResourceRuntime>;
  owner: {
    userId: string;
    deviceId: string;
    displayName: string;
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

export async function requireDesktopRequestContext(
  moduleKey: string,
  required: AccessLevel,
): Promise<DesktopRequestContext> {
  const base = await requireModuleRequestContext(moduleKey, required);
  const desktop = createDesktopSharedResourceRuntime();
  return {
    ...base,
    desktop,
    owner: {
      userId: base.user.id,
      deviceId: desktop.deviceId,
      displayName: base.user.displayName,
    },
  };
}

export function desktopRequestErrorStatus(code: string): number | null {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "PASSWORD_CHANGE_REQUIRED") return 403;
  if (code === "MODULE_FORBIDDEN" || code === "SPECIAL_PERMISSION_FORBIDDEN") return 403;
  return null;
}
