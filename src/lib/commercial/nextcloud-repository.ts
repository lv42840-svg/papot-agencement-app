import { randomUUID } from "node:crypto";
import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { parseCommercialPayload, type CommercialPayload } from "./domain";
import {
  CommercialRepositoryError,
  type CommercialMutationTransform,
  type CommercialRepository,
} from "./repository";

const COMMERCIAL_RESOURCE = { resource_type: "COMMERCIAL" as const, resource_id: "global" };
const LOCK_TTL_MS = 30_000;

type Desktop = DesktopRequestContext["desktop"];
type Owner = DesktopRequestContext["owner"];

export async function acquireNextcloudCommercialSnapshot(params: {
  desktop: Desktop;
  owner: Owner;
}): Promise<{ payload: CommercialPayload; release(): Promise<void> }> {
  const leaseId = randomUUID();
  const lockResult = await params.desktop.locks.acquire({
    resource: COMMERCIAL_RESOURCE,
    leaseId,
    owner: params.owner,
    baseVersion: 0,
    ttlMs: LOCK_TTL_MS,
    reclaimOwnAfterMs: 0,
  });

  if (lockResult.status === "locked") {
    throw new CommercialRepositoryError("COMMERCIAL_LOCKED", {
      lockedBy: lockResult.lock.owner_display_name,
    });
  }

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await params.desktop.locks.release({
      resource: COMMERCIAL_RESOURCE,
      leaseId,
      owner: params.owner,
    });
  };

  try {
    const resource = await params.desktop.states.get(COMMERCIAL_RESOURCE);
    return { payload: parseCommercialPayload(resource?.payload), release };
  } catch (error) {
    await release().catch((releaseError: unknown) => {
      const code =
        releaseError instanceof Error
          ? releaseError.message
          : "COMMERCIAL_CUTOVER_LOCK_RELEASE_FAILED";
      console.error("[PAPOT][Commercial] source lock release failed", { code });
    });
    throw error;
  }
}

export function createNextcloudCommercialRepository(params: {
  desktop: Desktop;
  owner: Owner;
}): CommercialRepository {
  async function persist(transform: CommercialMutationTransform) {
    const leaseId = randomUUID();
    let ownsLock = false;

    try {
      const [lockResult, initialOpened] = await Promise.all([
        params.desktop.locks.acquire({
          resource: COMMERCIAL_RESOURCE,
          leaseId,
          owner: params.owner,
          baseVersion: 0,
          ttlMs: LOCK_TTL_MS,
          reclaimOwnAfterMs: 0,
        }),
        params.desktop.states.openForUpdate(COMMERCIAL_RESOURCE),
      ]);

      if (lockResult.status === "locked") {
        throw new CommercialRepositoryError("COMMERCIAL_LOCKED", {
          lockedBy: lockResult.lock.owner_display_name,
        });
      }
      ownsLock = true;

      let opened = initialOpened;
      let mutation = await transform(parseCommercialPayload(opened.resource?.payload), false);
      if (mutation.shouldPersist === false) {
        return { payload: mutation.payload, focusCaseId: mutation.focusCaseId };
      }

      let saved = await params.desktop.states.saveOpened({
        resource: COMMERCIAL_RESOURCE,
        opened,
        payload: mutation.payload,
        actor: { userId: params.owner.userId, deviceId: params.owner.deviceId },
      });

      if (saved.status === "conflict") {
        opened = await params.desktop.states.openForUpdate(COMMERCIAL_RESOURCE);
        mutation = await transform(parseCommercialPayload(opened.resource?.payload), true);
        if (mutation.shouldPersist === false) {
          return { payload: mutation.payload, focusCaseId: mutation.focusCaseId };
        }
        saved = await params.desktop.states.saveOpened({
          resource: COMMERCIAL_RESOURCE,
          opened,
          payload: mutation.payload,
          actor: { userId: params.owner.userId, deviceId: params.owner.deviceId },
        });
      }

      if (saved.status === "conflict") {
        throw new CommercialRepositoryError("COMMERCIAL_VERSION_CONFLICT");
      }

      return {
        payload: parseCommercialPayload(saved.resource.payload),
        focusCaseId: mutation.focusCaseId,
      };
    } finally {
      if (ownsLock) {
        void params.desktop.locks
          .release({ resource: COMMERCIAL_RESOURCE, leaseId, owner: params.owner })
          .catch((error: unknown) => {
            const code = error instanceof Error ? error.message : "LOCK_RELEASE_FAILED";
            console.error("[PAPOT][Commercial] lock release failed", { code });
          });
      }
    }
  }

  return {
    async load() {
      const cached = params.desktop.states.getCached(COMMERCIAL_RESOURCE);
      if (cached !== undefined) {
        void params.desktop.states.get(COMMERCIAL_RESOURCE).catch((error: unknown) => {
          const code = error instanceof Error ? error.message : "COMMERCIAL_REFRESH_FAILED";
          console.error("[PAPOT][Commercial] background refresh failed", { code });
        });
        return parseCommercialPayload(cached?.payload);
      }

      const resource = await params.desktop.states.get(COMMERCIAL_RESOURCE);
      return parseCommercialPayload(resource?.payload);
    },
    mutate: persist,
  };
}
