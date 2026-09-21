import { randomUUID } from "node:crypto";
import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { parseChantiersPayload } from "./domain";
import { ChantiersRepositoryError } from "./repository";

const CHANTIERS_RESOURCE = { resource_type: "CHANTIER" as const, resource_id: "registry" };
const LOCK_TTL_MS = 30_000;

type Desktop = DesktopRequestContext["desktop"];
type Owner = DesktopRequestContext["owner"];

export async function acquireNextcloudChantiersSnapshot(params: {
  desktop: Desktop;
  owner: Owner;
}) {
  const leaseId = randomUUID();
  const lockResult = await params.desktop.locks.acquire({
    resource: CHANTIERS_RESOURCE,
    leaseId,
    owner: params.owner,
    baseVersion: 0,
    ttlMs: LOCK_TTL_MS,
    reclaimOwnAfterMs: 0,
  });

  if (lockResult.status === "locked") {
    throw new ChantiersRepositoryError("CHANTIERS_LOCKED", {
      lockedBy: lockResult.lock.owner_display_name,
    });
  }

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await params.desktop.locks.release({
      resource: CHANTIERS_RESOURCE,
      leaseId,
      owner: params.owner,
    });
  };

  try {
    const resource = await params.desktop.states.get(CHANTIERS_RESOURCE);
    return { payload: parseChantiersPayload(resource?.payload), release };
  } catch (error) {
    await release().catch((releaseError: unknown) => {
      const code =
        releaseError instanceof Error
          ? releaseError.message
          : "CHANTIERS_CUTOVER_LOCK_RELEASE_FAILED";
      console.error("[PAPOT][Chantiers] source lock release failed", { code });
    });
    throw error;
  }
}
