import { describe, expect, it } from "vitest";
import {
  createResourceLock,
  hasSharedResourceVersionConflict,
  isResourceLockExpired,
  isResourceLockOwnedBy,
  nextSharedResourceVersion,
  renewResourceLock,
  resourceLockBlocksWrite,
  resourceLockPathSegments,
  sharedResourceLockSchema,
} from "../src/lib/sync/resource-lock";

const userId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const otherUserId = "33333333-3333-4333-8333-333333333333";
const leaseId = "44444444-4444-4444-8444-444444444444";

const resource = {
  resource_type: "CHANTIER" as const,
  resource_id: "chantier-dupont-42",
};

const owner = {
  userId,
  deviceId,
  displayName: "Lucien",
};

describe("shared resource lock protocol", () => {
  it("builds a deterministic Nextcloud lock path", () => {
    expect(resourceLockPathSegments(resource)).toEqual([
      "locks",
      "chantier",
      "chantier-dupont-42.json",
    ]);
  });

  it("creates a five-minute lease by default and blocks writes while active", () => {
    const now = new Date("2026-09-12T15:00:00.000Z");
    const lock = createResourceLock({
      resource,
      leaseId,
      owner,
      baseVersion: 7,
      now,
    });

    expect(lock.base_version).toBe(7);
    expect(lock.acquired_at).toBe("2026-09-12T15:00:00.000Z");
    expect(lock.expires_at).toBe("2026-09-12T15:05:00.000Z");
    expect(resourceLockBlocksWrite(lock, new Date("2026-09-12T15:04:59.999Z"))).toBe(true);
    expect(isResourceLockExpired(lock, new Date("2026-09-12T15:05:00.000Z"))).toBe(true);
    expect(resourceLockBlocksWrite(lock, new Date("2026-09-12T15:05:00.000Z"))).toBe(false);
  });

  it("requires the same lease, user and device before renewal", () => {
    const current = createResourceLock({
      resource,
      leaseId,
      owner,
      baseVersion: 3,
      now: new Date("2026-09-12T15:00:00.000Z"),
    });

    expect(isResourceLockOwnedBy(current, leaseId, owner)).toBe(true);
    expect(
      isResourceLockOwnedBy(current, leaseId, {
        userId: otherUserId,
        deviceId,
      }),
    ).toBe(false);

    expect(() =>
      renewResourceLock({
        current,
        leaseId,
        owner: { userId: otherUserId, deviceId },
        now: new Date("2026-09-12T15:01:00.000Z"),
      }),
    ).toThrow("LOCK_NOT_OWNED");
  });

  it("renews only an active owned lease while keeping the original acquisition time", () => {
    const current = createResourceLock({
      resource,
      leaseId,
      owner,
      baseVersion: 3,
      now: new Date("2026-09-12T15:00:00.000Z"),
    });

    const renewed = renewResourceLock({
      current,
      leaseId,
      owner,
      now: new Date("2026-09-12T15:02:00.000Z"),
    });

    expect(renewed.acquired_at).toBe("2026-09-12T15:00:00.000Z");
    expect(renewed.renewed_at).toBe("2026-09-12T15:02:00.000Z");
    expect(renewed.expires_at).toBe("2026-09-12T15:07:00.000Z");
  });

  it("refuses malformed leases whose expiry is not after renewal", () => {
    const result = sharedResourceLockSchema.safeParse({
      schema_version: 1,
      resource,
      lease_id: leaseId,
      owner_user_id: userId,
      owner_device_id: deviceId,
      owner_display_name: "Lucien",
      base_version: 0,
      acquired_at: "2026-09-12T15:00:00.000Z",
      renewed_at: "2026-09-12T15:02:00.000Z",
      expires_at: "2026-09-12T15:02:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("detects an optimistic version conflict before save", () => {
    expect(hasSharedResourceVersionConflict(12, 12)).toBe(false);
    expect(hasSharedResourceVersionConflict(12, 13)).toBe(true);
    expect(nextSharedResourceVersion(12)).toBe(13);
  });
});
