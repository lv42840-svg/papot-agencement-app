import "server-only";

import { readAuthPayload } from "@/lib/auth/store";

export type CommercialAssignableUser = {
  id: string;
  displayName: string;
};

export async function listCommercialAssignableUsers(): Promise<CommercialAssignableUser[]> {
  const donneesAuthentification = await readAuthPayload();
  return donneesAuthentification.users
    .filter(
      (utilisateur) =>
        utilisateur.isActive && Boolean(utilisateur.modulePermissions.commercial),
    )
    .sort((utilisateurA, utilisateurB) =>
      utilisateurA.displayName.localeCompare(utilisateurB.displayName, "fr", {
        sensitivity: "base",
      }),
    )
    .map((utilisateur) => ({ id: utilisateur.id, displayName: utilisateur.displayName }));
}
