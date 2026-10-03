import "server-only";

import type { ModuleRequestContext } from "@/lib/auth/module-request-context";
import { readAuthPayload } from "@/lib/auth/store";
import type { EntriesActor } from "./mutations";

export async function buildEntriesActor(context: ModuleRequestContext): Promise<EntriesActor> {
  const auth = await readAuthPayload();

  const assignmentCandidates = auth.users
    .filter((user) => user.isActive && Boolean(user.modulePermissions.capture))
    .map((user) => user.displayName);

  const notificationRecipients = auth.users
    .filter((user) => user.isActive && user.canManagePermissions)
    .map((user) => user.displayName);

  return {
    userId: context.user.id,
    displayName: context.user.displayName,
    canQualify: context.moduleAccess.canWrite,
    canManageTags: context.user.canManagePermissions,
    assignmentCandidates,
    notificationRecipients,
  };
}
