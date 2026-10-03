import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { SharedResourceEditCoordinator } from "@/lib/sync/resource-edit-coordinator";
import type { AcquireResourceLockResult } from "@/lib/sync/resource-lock-store";
import {
  createResourceLock,
  isResourceLockExpired,
  isResourceLockOwnedBy,
  nextSharedResourceVersion,
  renewResourceLock,
  sharedResourceEnvelopeSchema,
  sharedResourceLockSchema,
  sharedResourceRefSchema,
  type ResourceLockOwner,
  type SharedResourceEnvelope,
  type SharedResourceLock,
  type SharedResourceRef,
} from "@/lib/sync/resource-lock";
import type {
  SaveSharedResourceResult,
  SharedResourceActor,
} from "@/lib/sync/resource-state-store";
import { getLocalDatabase, withLocalDatabaseWrite } from "./runtime";

function parseJson(text: string, errorCode: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(errorCode);
  }
}

function resourceParts(resource: SharedResourceRef): [string, string] {
  const parsed = sharedResourceRefSchema.parse(resource);
  return [parsed.resource_type, parsed.resource_id];
}

function readEnvelope(
  database: DatabaseSync,
  resource: SharedResourceRef,
): SharedResourceEnvelope | null {
  const [resourceType, resourceId] = resourceParts(resource);
  const row = database
    .prepare(
      `
        SELECT envelope_json
        FROM local_shared_resource_states
        WHERE resource_type = ? AND resource_id = ?
      `,
    )
    .get(resourceType, resourceId) as { envelope_json: string } | undefined;
  if (!row) return null;
  return sharedResourceEnvelopeSchema.parse(
    parseJson(row.envelope_json, "LOCAL_RESOURCE_INVALID_JSON"),
  );
}

function writeEnvelope(database: DatabaseSync, envelope: SharedResourceEnvelope): void {
  const [resourceType, resourceId] = resourceParts(envelope.resource);
  database
    .prepare(
      `
        INSERT INTO local_shared_resource_states (
          resource_type,
          resource_id,
          envelope_json,
          updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(resource_type, resource_id) DO UPDATE SET
          envelope_json = excluded.envelope_json,
          updated_at = excluded.updated_at
      `,
    )
    .run(resourceType, resourceId, JSON.stringify(envelope), envelope.updated_at);
}

function readLock(database: DatabaseSync, resource: SharedResourceRef): SharedResourceLock | null {
  const [resourceType, resourceId] = resourceParts(resource);
  const row = database
    .prepare(
      `
        SELECT lock_json
        FROM local_shared_resource_locks
        WHERE resource_type = ? AND resource_id = ?
      `,
    )
    .get(resourceType, resourceId) as { lock_json: string } | undefined;
  if (!row) return null;
  return sharedResourceLockSchema.parse(parseJson(row.lock_json, "LOCAL_LOCK_INVALID_JSON"));
}

function writeLock(database: DatabaseSync, lock: SharedResourceLock): void {
  const [resourceType, resourceId] = resourceParts(lock.resource);
  database
    .prepare(
      `
        INSERT INTO local_shared_resource_locks (
          resource_type,
          resource_id,
          lock_json,
          updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(resource_type, resource_id) DO UPDATE SET
          lock_json = excluded.lock_json,
          updated_at = excluded.updated_at
      `,
    )
    .run(resourceType, resourceId, JSON.stringify(lock), lock.renewed_at);
}

function deleteLock(database: DatabaseSync, resource: SharedResourceRef): void {
  const [resourceType, resourceId] = resourceParts(resource);
  database
    .prepare(
      `
        DELETE FROM local_shared_resource_locks
        WHERE resource_type = ? AND resource_id = ?
      `,
    )
    .run(resourceType, resourceId);
}

export class LocalSharedResourceStore {
  private readonly cache = new Map<string, SharedResourceEnvelope | null>();

  private cacheKey(resource: SharedResourceRef): string {
    const [resourceType, resourceId] = resourceParts(resource);
    return `${resourceType}:${resourceId}`;
  }

  getCached(resource: SharedResourceRef): SharedResourceEnvelope | null | undefined {
    return this.cache.get(this.cacheKey(resource));
  }

  async get(resource: SharedResourceRef): Promise<SharedResourceEnvelope | null> {
    const envelope = readEnvelope(getLocalDatabase(), resource);
    this.cache.set(this.cacheKey(resource), envelope);
    return envelope;
  }

  async save(params: {
    resource: SharedResourceRef;
    expectedVersion: number;
    payload: unknown;
    actor: SharedResourceActor;
    now?: Date;
  }): Promise<SaveSharedResourceResult> {
    if (!Number.isInteger(params.expectedVersion) || params.expectedVersion < 0) {
      throw new Error("EXPECTED_VERSION_INVALID");
    }

    const result = await withLocalDatabaseWrite((database) => {
      const current = readEnvelope(database, params.resource);
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== params.expectedVersion) {
        return { status: "conflict" as const, current };
      }

      const now = params.now ?? new Date();
      const candidate = sharedResourceEnvelopeSchema.parse({
        schema_version: 1,
        resource: params.resource,
        version: nextSharedResourceVersion(currentVersion),
        updated_at: now.toISOString(),
        updated_by_user_id: params.actor.userId,
        updated_by_device_id: params.actor.deviceId,
        payload: params.payload,
      });
      writeEnvelope(database, candidate);
      return { status: "saved" as const, resource: candidate };
    });

    this.cache.set(
      this.cacheKey(params.resource),
      result.status === "saved" ? result.resource : result.current,
    );
    return result;
  }
}

export class LocalResourceLockStore {
  async getActiveLock(
    resource: SharedResourceRef,
    now: Date = new Date(),
  ): Promise<SharedResourceLock | null> {
    const lock = readLock(getLocalDatabase(), resource);
    return lock && !isResourceLockExpired(lock, now) ? lock : null;
  }

  async acquire(params: {
    resource: SharedResourceRef;
    leaseId: string;
    owner: ResourceLockOwner;
    baseVersion: number;
    now?: Date;
    ttlMs?: number;
    reclaimOwnAfterMs?: number;
  }): Promise<AcquireResourceLockResult> {
    return withLocalDatabaseWrite((database) => {
      const now = params.now ?? new Date();
      const current = readLock(database, params.resource);
      if (current && !isResourceLockExpired(current, now)) {
        const isSameOwner =
          current.owner_user_id === params.owner.userId &&
          current.owner_device_id === params.owner.deviceId;
        const ageMs = now.getTime() - Date.parse(current.renewed_at);
        const canReclaim =
          isSameOwner &&
          params.reclaimOwnAfterMs !== undefined &&
          ageMs >= params.reclaimOwnAfterMs;
        if (!canReclaim) return { status: "locked" as const, lock: current };
      }

      const lock = createResourceLock({ ...params, now });
      writeLock(database, lock);
      return { status: "acquired" as const, lock };
    });
  }

  async renew(params: {
    resource: SharedResourceRef;
    leaseId: string;
    owner: Pick<ResourceLockOwner, "userId" | "deviceId">;
    now?: Date;
    ttlMs?: number;
  }): Promise<SharedResourceLock> {
    return withLocalDatabaseWrite((database) => {
      const current = readLock(database, params.resource);
      if (!current) throw new Error("LOCK_NOT_FOUND");
      const renewed = renewResourceLock({ current, ...params });
      writeLock(database, renewed);
      return renewed;
    });
  }

  async release(params: {
    resource: SharedResourceRef;
    leaseId: string;
    owner: Pick<ResourceLockOwner, "userId" | "deviceId">;
  }): Promise<boolean> {
    return withLocalDatabaseWrite((database) => {
      const current = readLock(database, params.resource);
      if (!current) return false;
      if (!isResourceLockOwnedBy(current, params.leaseId, params.owner)) {
        throw new Error("LOCK_NOT_OWNED");
      }
      deleteLock(database, params.resource);
      return true;
    });
  }
}

let cachedRuntime:
  | {
      states: LocalSharedResourceStore;
      locks: LocalResourceLockStore;
      coordinator: SharedResourceEditCoordinator;
      deviceId: string;
    }
  | undefined;

export function createLocalSharedResourceRuntime() {
  if (cachedRuntime) return cachedRuntime;
  const states = new LocalSharedResourceStore();
  const locks = new LocalResourceLockStore();
  cachedRuntime = {
    states,
    locks,
    coordinator: new SharedResourceEditCoordinator(locks, states),
    deviceId: randomUUID(),
  };
  return cachedRuntime;
}
