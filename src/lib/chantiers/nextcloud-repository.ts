import { randomUUID } from "node:crypto";
import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { parseChantiersPayload } from "./domain";
import {
  ChantiersRepositoryError,
  type ChantiersMutationTransform,
  type ChantiersRepository,
} from "./repository";

const CHANTIERS_RESOURCE = { resource_type: "CHANTIER" as const, resource_id: "registry" };
const LOCK_TTL_MS = 30_000;

type Desktop = DesktopRequestContext["desktop"];
type Owner = DesktopRequestContext["owner"];

export function createNextcloudChantiersRepository(params: {
  desktop: Desktop;
  owner: Owner;
}): ChantiersRepository {
  async function persist(transform: ChantiersMutationTransform) {
    const leaseId = randomUUID();
    let ownsLock = false;

    try {
      const [lockResult, initialOpened] = await Promise.all([
        params.desktop.locks.acquire({
          resource: CHANTIERS_RESOURCE,
          leaseId,
          owner: params.owner,
          baseVersion: 0,
          ttlMs: LOCK_TTL_MS,
          reclaimOwnAfterMs: 0,
        }),
        params.desktop.states.openForUpdate(CHANTIERS_RESOURCE),
      ]);

      if (lockResult.status === "locked") {
        throw new ChantiersRepositoryError("CHANTIERS_LOCKED", {
          lockedBy: lockResult.lock.owner_display_name,
        });
      }
      ownsLock = true;

      let opened = initialOpened;
      let mutation = await transform(parseChantiersPayload(opened.resource?.payload), false);
      if (mutation.shouldPersist === false) {
        return { payload: mutation.payload, focusChantierId: mutation.focusChantierId };
      }

      let saved = await params.desktop.states.saveOpened({
        resource: CHANTIERS_RESOURCE,
        opened,
        payload: mutation.payload,
        actor: { userId: params.owner.userId, deviceId: params.owner.deviceId },
      });

      if (saved.status === "conflict") {
        opened = await params.desktop.states.openForUpdate(CHANTIERS_RESOURCE);
        mutation = await transform(parseChantiersPayload(opened.resource?.payload), true);
        if (mutation.shouldPersist === false) {
          return { payload: mutation.payload, focusChantierId: mutation.focusChantierId };
        }
        saved = await params.desktop.states.saveOpened({
          resource: CHANTIERS_RESOURCE,
          opened,
          payload: mutation.payload,
          actor: { userId: params.owner.userId, deviceId: params.owner.deviceId },
        });
      }

      if (saved.status === "conflict") {
        throw new ChantiersRepositoryError("CHANTIERS_VERSION_CONFLICT");
      }

      return {
        payload: parseChantiersPayload(saved.resource.payload),
        focusChantierId: mutation.focusChantierId,
      };
    } finally {
      if (ownsLock) {
        void params.desktop.locks
          .release({ resource: CHANTIERS_RESOURCE, leaseId, owner: params.owner })
          .catch((error: unknown) => {
            const code = error instanceof Error ? error.message : "LOCK_RELEASE_FAILED";
            console.error("[PAPOT][Chantiers] lock release failed", { code });
          });
      }
    }
  }

  return {
    async load() {
      const cached = params.desktop.states.getCached(CHANTIERS_RESOURCE);
      if (cached !== undefined) {
        void params.desktop.states.get(CHANTIERS_RESOURCE).catch((error: unknown) => {
          const code = error instanceof Error ? error.message : "CHANTIERS_REFRESH_FAILED";
          console.error("[PAPOT][Chantiers] background refresh failed", { code });
        });
        return parseChantiersPayload(cached?.payload);
      }

      const resource = await params.desktop.states.get(CHANTIERS_RESOURCE);
      return parseChantiersPayload(resource?.payload);
    },
    mutate: persist,
  };
}
