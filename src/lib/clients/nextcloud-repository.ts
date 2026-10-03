import { randomUUID } from "node:crypto";
import type { NextcloudResourceLockStore } from "@/lib/sync/resource-lock-store";
import type { NextcloudSharedResourceStore } from "@/lib/sync/resource-state-store";
import { parseClientsPayload, type ClientsPayload } from "./domain";
import { applyClientsMutation } from "./mutations";
import { ClientsRepositoryError, type ClientsRepository } from "./repository";

const CLIENTS_RESOURCE = {
  resource_type: "CLIENTS" as const,
  resource_id: "global",
};
const CLIENTS_WRITE_LOCK_TTL_MS = 30_000;
const CLIENTS_OWN_LOCK_RECLAIM_AFTER_MS = 0;

type Owner = { userId: string; deviceId: string; displayName: string };
type ClientsStates = Pick<
  NextcloudSharedResourceStore,
  "getCached" | "get" | "openForUpdate" | "saveOpened"
>;
type ClientsLocks = Pick<NextcloudResourceLockStore, "acquire" | "release">;

export async function acquireNextcloudClientsSnapshot(params: {
  states: Pick<ClientsStates, "get">;
  locks: ClientsLocks;
  owner: Owner;
}): Promise<{ payload: ClientsPayload; release(): Promise<void> }> {
  const leaseId = randomUUID();
  const lockResult = await params.locks.acquire({
    resource: CLIENTS_RESOURCE,
    leaseId,
    owner: params.owner,
    baseVersion: 0,
    ttlMs: CLIENTS_WRITE_LOCK_TTL_MS,
    reclaimOwnAfterMs: CLIENTS_OWN_LOCK_RECLAIM_AFTER_MS,
  });

  if (lockResult.status === "locked") {
    throw new ClientsRepositoryError("CLIENTS_LOCKED", {
      lockedBy: lockResult.lock.owner_display_name,
    });
  }

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await params.locks.release({ resource: CLIENTS_RESOURCE, leaseId, owner: params.owner });
  };

  try {
    const resource = await params.states.get(CLIENTS_RESOURCE);
    return { payload: parseClientsPayload(resource?.payload), release };
  } catch (error) {
    await release().catch((releaseError: unknown) => {
      const code =
        releaseError instanceof Error
          ? releaseError.message
          : "CLIENTS_CUTOVER_LOCK_RELEASE_FAILED";
      console.error("[PAPOT][Clients] source lock release failed", { code });
    });
    throw error;
  }
}

export function createNextcloudClientsRepository(params: {
  states: ClientsStates;
  locks: ClientsLocks;
  owner: Owner;
}): ClientsRepository {
  return {
    async load() {
      const cached = params.states.getCached(CLIENTS_RESOURCE);
      if (cached !== undefined) {
        void params.states.get(CLIENTS_RESOURCE).catch((error: unknown) => {
          const code = error instanceof Error ? error.message : "CLIENTS_REFRESH_FAILED";
          console.error("[PAPOT][Clients] background refresh failed", { code });
        });
        return parseClientsPayload(cached?.payload);
      }

      const resource = await params.states.get(CLIENTS_RESOURCE);
      return parseClientsPayload(resource?.payload);
    },

    async mutate(input, actor) {
      const leaseId = randomUUID();
      let ownsLock = false;

      try {
        const [lockResult, initialOpened] = await Promise.all([
          params.locks.acquire({
            resource: CLIENTS_RESOURCE,
            leaseId,
            owner: params.owner,
            baseVersion: 0,
            ttlMs: CLIENTS_WRITE_LOCK_TTL_MS,
            reclaimOwnAfterMs: CLIENTS_OWN_LOCK_RECLAIM_AFTER_MS,
          }),
          params.states.openForUpdate(CLIENTS_RESOURCE),
        ]);

        if (lockResult.status === "locked") {
          throw new ClientsRepositoryError("CLIENTS_LOCKED", {
            lockedBy: lockResult.lock.owner_display_name,
          });
        }
        ownsLock = true;

        let opened = initialOpened;
        let mutation = applyClientsMutation(
          parseClientsPayload(opened.resource?.payload),
          input,
          actor,
        );
        let saved = await params.states.saveOpened({
          resource: CLIENTS_RESOURCE,
          opened,
          payload: mutation.payload,
          actor: { userId: params.owner.userId, deviceId: params.owner.deviceId },
        });

        if (saved.status === "conflict") {
          opened = await params.states.openForUpdate(CLIENTS_RESOURCE);
          mutation = applyClientsMutation(
            parseClientsPayload(opened.resource?.payload),
            input,
            actor,
          );
          saved = await params.states.saveOpened({
            resource: CLIENTS_RESOURCE,
            opened,
            payload: mutation.payload,
            actor: { userId: params.owner.userId, deviceId: params.owner.deviceId },
          });
        }

        if (saved.status === "conflict") {
          throw new ClientsRepositoryError("CLIENTS_VERSION_CONFLICT");
        }

        return {
          payload: parseClientsPayload(saved.resource.payload),
          focusClientId: mutation.focusClientId,
        };
      } finally {
        if (ownsLock) {
          void params.locks
            .release({ resource: CLIENTS_RESOURCE, leaseId, owner: params.owner })
            .catch((error: unknown) => {
              const code = error instanceof Error ? error.message : "LOCK_RELEASE_FAILED";
              console.error("[PAPOT][Clients] lock release failed", { code });
            });
        }
      }
    },
  };
}
