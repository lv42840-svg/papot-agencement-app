import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SharedResourceEditCoordinator } from "../src/lib/sync/resource-edit-coordinator";
import {
  createResourceLock,
  isResourceLockExpired,
  isResourceLockOwnedBy,
  renewResourceLock,
  sharedResourceEnvelopeSchema,
  type ResourceLockOwner,
  type SharedResourceEnvelope,
  type SharedResourceLock,
  type SharedResourceRef,
} from "../src/lib/sync/resource-lock";

const resource: SharedResourceRef = {
  resource_type: "CHANTIER",
  resource_id: "chantier-dupont",
};

const lucien: ResourceLockOwner = {
  userId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  displayName: "Lucien",
};

const nadia: ResourceLockOwner = {
  userId: "33333333-3333-4333-8333-333333333333",
  deviceId: "44444444-4444-4444-8444-444444444444",
  displayName: "Nadia",
};

class FakeLocks {
  current: SharedResourceLock | null = null;

  async acquire(params: {
    resource: SharedResourceRef;
    leaseId: string;
    owner: ResourceLockOwner;
    baseVersion: number;
    now?: Date;
    ttlMs?: number;
  }) {
    const now = params.now ?? new Date();
    if (this.current && !isResourceLockExpired(this.current, now)) {
      return { status: "locked" as const, lock: this.current };
    }

    this.current = createResourceLock({ ...params, now });
    return { status: "acquired" as const, lock: this.current };
  }

  async renew(params: {
    resource: SharedResourceRef;
    leaseId: string;
    owner: Pick<ResourceLockOwner, "userId" | "deviceId">;
    now?: Date;
    ttlMs?: number;
  }) {
    if (!this.current) throw new Error("LOCK_NOT_FOUND");
    this.current = renewResourceLock({
      current: this.current,
      leaseId: params.leaseId,
      owner: params.owner,
      now: params.now,
      ttlMs: params.ttlMs,
    });
    return this.current;
  }

  async release(params: {
    resource: SharedResourceRef;
    leaseId: string;
    owner: Pick<ResourceLockOwner, "userId" | "deviceId">;
  }) {
    if (!this.current) return false;
    if (!isResourceLockOwnedBy(this.current, params.leaseId, params.owner)) {
      throw new Error("LOCK_NOT_OWNED");
    }
    this.current = null;
    return true;
  }
}

class FakeStates {
  current: SharedResourceEnvelope | null = null;

  async get(_resource: SharedResourceRef) {
    return this.current;
  }

  async save(params: {
    resource: SharedResourceRef;
    expectedVersion: number;
    payload: unknown;
    actor: { userId: string; deviceId: string };
    now?: Date;
  }) {
    const currentVersion = this.current?.version ?? 0;
    if (currentVersion !== params.expectedVersion) {
      return { status: "conflict" as const, current: this.current };
    }

    this.current = sharedResourceEnvelopeSchema.parse({
      schema_version: 1,
      resource: params.resource,
      version: params.expectedVersion + 1,
      updated_at: (params.now ?? new Date()).toISOString(),
      updated_by_user_id: params.actor.userId,
      updated_by_device_id: params.actor.deviceId,
      payload: params.payload,
    });

    return { status: "saved" as const, resource: this.current };
  }

  forceVersion(version: number, payload: unknown, actor = nadia) {
    this.current = sharedResourceEnvelopeSchema.parse({
      schema_version: 1,
      resource,
      version,
      updated_at: new Date("2026-09-12T15:00:00.000Z").toISOString(),
      updated_by_user_id: actor.userId,
      updated_by_device_id: actor.deviceId,
      payload,
    });
  }
}

function setup() {
  const locks = new FakeLocks();
  const states = new FakeStates();
  return {
    locks,
    states,
    coordinator: new SharedResourceEditCoordinator(locks, states),
  };
}

describe("SharedResourceEditCoordinator", () => {
  it("opens an unlocked resource in editable mode", async () => {
    const { coordinator } = setup();
    const result = await coordinator.open({
      resource,
      leaseId: randomUUID(),
      owner: lucien,
      now: new Date("2026-09-12T15:00:00.000Z"),
    });

    expect(result.status).toBe("editable");
    expect(result.baseVersion).toBe(0);
  });

  it("puts the second user in read-only mode while Lucien owns the lock", async () => {
    const { coordinator } = setup();
    const lucienLeaseId = randomUUID();

    await coordinator.open({
      resource,
      leaseId: lucienLeaseId,
      owner: lucien,
      now: new Date("2026-09-12T15:00:00.000Z"),
    });

    const result = await coordinator.open({
      resource,
      leaseId: randomUUID(),
      owner: nadia,
      now: new Date("2026-09-12T15:00:30.000Z"),
    });

    expect(result.status).toBe("read-only");
    expect(result.lock.owner_display_name).toBe("Lucien");
  });

  it("saves only after proving that the editing lease is still active", async () => {
    const { coordinator } = setup();
    const leaseId = randomUUID();

    const opened = await coordinator.open({
      resource,
      leaseId,
      owner: lucien,
      now: new Date("2026-09-12T15:00:00.000Z"),
    });
    expect(opened.status).toBe("editable");

    const saved = await coordinator.save({
      resource,
      leaseId,
      owner: lucien,
      expectedVersion: opened.baseVersion,
      payload: { title: "Dupont" },
      now: new Date("2026-09-12T15:01:00.000Z"),
    });

    expect(saved.status).toBe("saved");
    if (saved.status === "saved") expect(saved.resource.version).toBe(1);
  });

  it("blocks a stale save even if the user still owns the lock", async () => {
    const { coordinator, states } = setup();
    const leaseId = randomUUID();

    const opened = await coordinator.open({
      resource,
      leaseId,
      owner: lucien,
      now: new Date("2026-09-12T15:00:00.000Z"),
    });
    expect(opened.status).toBe("editable");

    states.forceVersion(1, { title: "Version plus recente" });

    const result = await coordinator.save({
      resource,
      leaseId,
      owner: lucien,
      expectedVersion: 0,
      payload: { title: "Ancienne copie" },
      now: new Date("2026-09-12T15:01:00.000Z"),
    });

    expect(result.status).toBe("conflict");
    if (result.status === "conflict") expect(result.current?.version).toBe(1);
  });

  it("refuses to save after the editing lease has expired", async () => {
    const { coordinator } = setup();
    const leaseId = randomUUID();

    await coordinator.open({
      resource,
      leaseId,
      owner: lucien,
      now: new Date("2026-09-12T15:00:00.000Z"),
      ttlMs: 1_000,
    });

    await expect(
      coordinator.save({
        resource,
        leaseId,
        owner: lucien,
        expectedVersion: 0,
        payload: { title: "Trop tard" },
        now: new Date("2026-09-12T15:00:02.000Z"),
      }),
    ).rejects.toThrow("LOCK_EXPIRED");
  });

  it("releases the edit lock so another user can become editor", async () => {
    const { coordinator } = setup();
    const lucienLeaseId = randomUUID();

    await coordinator.open({
      resource,
      leaseId: lucienLeaseId,
      owner: lucien,
      now: new Date("2026-09-12T15:00:00.000Z"),
    });

    await coordinator.release({ resource, leaseId: lucienLeaseId, owner: lucien });

    const result = await coordinator.open({
      resource,
      leaseId: randomUUID(),
      owner: nadia,
      now: new Date("2026-09-12T15:00:10.000Z"),
    });

    expect(result.status).toBe("editable");
  });
});
