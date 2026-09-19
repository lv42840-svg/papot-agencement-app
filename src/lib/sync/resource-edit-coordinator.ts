import type { NextcloudResourceLockStore } from "./resource-lock-store";
import type {
  ResourceLockOwner,
  SharedResourceEnvelope,
  SharedResourceLock,
  SharedResourceRef,
} from "./resource-lock";
import type {
  NextcloudSharedResourceStore,
  SaveSharedResourceResult,
} from "./resource-state-store";

type LockStore = Pick<NextcloudResourceLockStore, "acquire" | "renew" | "release">;
type StateStore = Pick<NextcloudSharedResourceStore, "get" | "save">;

export type OpenSharedResourceResult =
  | {
      status: "editable";
      resource: SharedResourceEnvelope | null;
      lock: SharedResourceLock;
      baseVersion: number;
    }
  | {
      status: "read-only";
      resource: SharedResourceEnvelope | null;
      lock: SharedResourceLock;
      baseVersion: number;
    };

export class SharedResourceEditCoordinator {
  constructor(
    private readonly locks: LockStore,
    private readonly states: StateStore,
  ) {}

  async open(params: {
    resource: SharedResourceRef;
    leaseId: string;
    owner: ResourceLockOwner;
    now?: Date;
    ttlMs?: number;
  }): Promise<OpenSharedResourceResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = await this.states.get(params.resource);
      const baseVersion = before?.version ?? 0;

      const lockResult = await this.locks.acquire({
        resource: params.resource,
        leaseId: params.leaseId,
        owner: params.owner,
        baseVersion,
        now: params.now,
        ttlMs: params.ttlMs,
      });

      if (lockResult.status === "locked") {
        const latest = await this.states.get(params.resource);
        return {
          status: "read-only",
          resource: latest,
          lock: lockResult.lock,
          baseVersion: latest?.version ?? 0,
        };
      }

      const after = await this.states.get(params.resource);
      const afterVersion = after?.version ?? 0;
      if (afterVersion === baseVersion) {
        return {
          status: "editable",
          resource: after,
          lock: lockResult.lock,
          baseVersion,
        };
      }

      await this.locks.release({
        resource: params.resource,
        leaseId: params.leaseId,
        owner: params.owner,
      });
    }

    throw new Error("RESOURCE_OPEN_RACE");
  }

  async save(params: {
    resource: SharedResourceRef;
    leaseId: string;
    owner: ResourceLockOwner;
    expectedVersion: number;
    payload: unknown;
    now?: Date;
    ttlMs?: number;
  }): Promise<SaveSharedResourceResult> {
    await this.locks.renew({
      resource: params.resource,
      leaseId: params.leaseId,
      owner: params.owner,
      now: params.now,
      ttlMs: params.ttlMs,
    });

    return this.states.save({
      resource: params.resource,
      expectedVersion: params.expectedVersion,
      payload: params.payload,
      actor: {
        userId: params.owner.userId,
        deviceId: params.owner.deviceId,
      },
      now: params.now,
    });
  }

  async release(params: {
    resource: SharedResourceRef;
    leaseId: string;
    owner: Pick<ResourceLockOwner, "userId" | "deviceId">;
  }): Promise<boolean> {
    return this.locks.release(params);
  }
}
