import "server-only";

import { getCurrentUser } from "@/lib/auth/session";
import { hasModuleAccess, type AccessLevel } from "@/lib/auth/permissions";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";

export type DesktopRequestContext = {
  desktop: ReturnType<typeof createDesktopSharedResourceRuntime>;
  owner: {
    userId: string;
    deviceId: string;
    displayName: string;
  };
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
  moduleAccess: {
    canRead: boolean;
    canWrite: boolean;
  };
};

export async function requireDesktopRequestContext(
  moduleKey: string,
  required: AccessLevel,
): Promise<DesktopRequestContext> {
  const user = await getCurrentUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  if (user.mustChangePassword) throw new Error("PASSWORD_CHANGE_REQUIRED");

  const canWrite = await hasModuleAccess(user.id, moduleKey, "WRITE");
  const canRead = canWrite || (await hasModuleAccess(user.id, moduleKey, "READ"));

  if (required === "WRITE" ? !canWrite : !canRead) {
    throw new Error("MODULE_FORBIDDEN");
  }

  const desktop = createDesktopSharedResourceRuntime();
  return {
    desktop,
    user,
    moduleAccess: { canRead, canWrite },
    owner: {
      userId: user.id,
      deviceId: desktop.deviceId,
      displayName: user.displayName,
    },
  };
}

export function desktopRequestErrorStatus(code: string): number | null {
  if (code === "AUTH_REQUIRED") return 401;
  if (code === "PASSWORD_CHANGE_REQUIRED") return 403;
  if (code === "MODULE_FORBIDDEN" || code === "SPECIAL_PERMISSION_FORBIDDEN") return 403;
  return null;
}
