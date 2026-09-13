import "server-only";

import { readAuthPayload } from "@/lib/auth/store";

export type CommercialAssignableUser = {
  id: string;
  displayName: string;
};

export async function listCommercialAssignableUsers(): Promise<CommercialAssignableUser[]> {
  const payload = await readAuthPayload();
  return payload.users
    .filter((user) => user.isActive && Boolean(user.modulePermissions.commercial))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "fr", { sensitivity: "base" }))
    .map((user) => ({ id: user.id, displayName: user.displayName }));
}
