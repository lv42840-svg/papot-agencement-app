import "server-only";

import { readAuthPayload } from "@/lib/auth/store";
import { normalizePersonName, type EntriesPayload } from "./domain";
import type { EntriesActor } from "./mutations";

export async function listEntryAssigneeNames(
  payload: EntriesPayload,
  actor: EntriesActor,
): Promise<string[]> {
  const auth = await readAuthPayload();
  const names = new Map<string, string>();

  for (const user of auth.users) {
    if (!user.isActive || !user.modulePermissions.capture) continue;
    const key = normalizePersonName(user.displayName);
    if (key) names.set(key, user.displayName);
  }

  const actorKey = normalizePersonName(actor.displayName);
  if (actorKey && !names.has(actorKey)) names.set(actorKey, actor.displayName);

  for (const entry of payload.entries) {
    for (const candidate of [entry.assigneeName, entry.createdByName]) {
      if (!candidate) continue;
      const key = normalizePersonName(candidate);
      if (key && !names.has(key)) names.set(key, candidate);
    }
  }

  return [...names.values()].sort((a, b) => a.localeCompare(b, "fr-FR"));
}
