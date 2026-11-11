import "server-only";

import type { ModuleRequestContext } from "@/lib/auth/module-request-context";
import { readAuthPayload } from "@/lib/auth/store";
import type { EntriesActor } from "./mutations";

export async function buildEntriesActor(contexte: ModuleRequestContext): Promise<EntriesActor> {
  const authentification = await readAuthPayload();

  const candidatsAffectation = authentification.users
    .filter((utilisateur) => utilisateur.isActive && Boolean(utilisateur.modulePermissions.capture))
    .map((utilisateur) => utilisateur.displayName);

  const destinatairesNotifications = authentification.users
    .filter((utilisateur) => utilisateur.isActive && utilisateur.canManagePermissions)
    .map((utilisateur) => utilisateur.displayName);

  return {
    userId: contexte.user.id,
    displayName: contexte.user.displayName,
    canQualify: contexte.moduleAccess.canWrite,
    canManageTags: contexte.user.canManagePermissions,
    assignmentCandidates: candidatsAffectation,
    notificationRecipients: destinatairesNotifications,
  };
}
