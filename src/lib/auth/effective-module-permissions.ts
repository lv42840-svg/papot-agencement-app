import type { AccessLevel } from "./domain";

export type ModuleAccessUser = {
  canManagePermissions: boolean;
  modulePermissions: Record<string, AccessLevel>;
};

export function effectiveModulePermissions(
  user: ModuleAccessUser,
): Record<string, AccessLevel> {
  const permissions = { ...user.modulePermissions };

  if (user.canManagePermissions && !permissions.quotes) {
    permissions.quotes = "WRITE";
  }

  return permissions;
}
