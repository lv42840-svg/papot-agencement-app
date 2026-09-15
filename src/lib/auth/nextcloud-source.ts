import "server-only";

import { randomUUID } from "node:crypto";

import type { NextcloudResourceLockStore } from "../sync/resource-lock-store";
import type { NextcloudSharedResourceStore } from "../sync/resource-state-store";
import { parseAuthPayload, type AuthPayload } from "./domain";

const AUTH_RESOURCE = { resource_type: "AUTH" as const, resource_id: "global" };
const AUTH_WRITE_LOCK_TTL_MS = 30_000;
const AUTH_OWN_LOCK_RECLAIM_AFTER_MS = 0;

type Owner = { userId: string; deviceId: string; displayName: string };
type AuthStates = Pick<NextcloudSharedResourceStore, "get">;
type AuthLocks = Pick<NextcloudResourceLockStore, "acquire" | "release">;

export type LockedAuthSnapshot = {
  payload: AuthPayload;
  release(): Promise<void>;
};

export async function acquireNextcloudAuthSnapshot(params: {
  states: AuthStates;
  locks: AuthLocks;
  owner: Owner;
}): Promise<LockedAuthSnapshot> {
  const leaseId = randomUUID();
  const lockResult = await params.locks.acquire({
    resource: AUTH_RESOURCE,
    leaseId,
    owner: params.owner,
    baseVersion: 0,
    ttlMs: AUTH_WRITE_LOCK_TTL_MS,
    reclaimOwnAfterMs: AUTH_OWN_LOCK_RECLAIM_AFTER_MS,
  });

  if (lockResult.status === "locked") {
    throw new Error("AUTH_LOCKED");
  }

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await params.locks.release({ resource: AUTH_RESOURCE, leaseId, owner: params.owner });
  };

  try {
    const resource = await params.states.get(AUTH_RESOURCE);
    return { payload: parseAuthPayload(resource?.payload), release };
  } catch (error) {
    await release().catch((releaseError: unknown) => {
      const code =
        releaseError instanceof Error ? releaseError.message : "AUTH_CUTOVER_LOCK_RELEASE_FAILED";
      console.error("[PAPOT][Auth] source lock release failed", { code });
    });
    throw error;
  }
}
