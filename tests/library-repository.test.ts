import { describe, expect, it, vi } from "vitest";
import type { DesktopRequestContext } from "../src/lib/desktop/request-context";
import { createSharedResourceLibraryRepository } from "../src/lib/library/shared-resource-repository";
import { LIBRARY_RESOURCE_REF } from "../src/lib/library/storage";

const owner = {
  userId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  displayName: "Test User",
};

function setup() {
  const statesGet = vi.fn(async () => null);
  const coordinatorOpen = vi.fn(async () => ({
    status: "editable" as const,
    resource: null,
    lock: {
      schema_version: 1 as const,
      resource: LIBRARY_RESOURCE_REF,
      lease_id: "33333333-3333-4333-8333-333333333333",
      owner_user_id: owner.userId,
      owner_device_id: owner.deviceId,
      owner_display_name: owner.displayName,
      base_version: 0,
      acquired_at: "2026-09-14T10:00:00.000Z",
      renewed_at: "2026-09-14T10:00:00.000Z",
      expires_at: "2026-09-14T10:05:00.000Z",
    },
    baseVersion: 0,
  }));
  const coordinatorSave = vi.fn(async () => ({ status: "conflict" as const, current: null }));
  const coordinatorRelease = vi.fn(async () => true);
  const locksRenew = vi.fn(async () => ({
    schema_version: 1 as const,
    resource: LIBRARY_RESOURCE_REF,
    lease_id: "33333333-3333-4333-8333-333333333333",
    owner_user_id: owner.userId,
    owner_device_id: owner.deviceId,
    owner_display_name: owner.displayName,
    base_version: 0,
    acquired_at: "2026-09-14T10:00:00.000Z",
    renewed_at: "2026-09-14T10:01:00.000Z",
    expires_at: "2026-09-14T10:06:00.000Z",
  }));

  const desktop = {
    states: { get: statesGet },
    coordinator: {
      open: coordinatorOpen,
      save: coordinatorSave,
      release: coordinatorRelease,
    },
    locks: { renew: locksRenew },
  } as unknown as DesktopRequestContext["desktop"];

  return {
    repository: createSharedResourceLibraryRepository({ desktop, owner }),
    statesGet,
    coordinatorOpen,
    coordinatorSave,
    coordinatorRelease,
    locksRenew,
  };
}

describe("Library repository boundary", () => {
  it("loads the fixed Library catalog through the repository", async () => {
    const { repository, statesGet } = setup();

    await expect(repository.load()).resolves.toEqual({
      version: 0,
      payload: { schemaVersion: 1, components: [], ouvrages: [] },
    });
    expect(statesGet).toHaveBeenCalledWith(LIBRARY_RESOURCE_REF);
  });

  it("opens the fixed Library resource with the current owner", async () => {
    const { repository, coordinatorOpen } = setup();
    const leaseId = "33333333-3333-4333-8333-333333333333";

    await repository.open(leaseId);

    expect(coordinatorOpen).toHaveBeenCalledWith({
      resource: LIBRARY_RESOURCE_REF,
      leaseId,
      owner,
    });
  });

  it("validates Library payloads before saving them", async () => {
    const { repository, coordinatorSave } = setup();
    const leaseId = "33333333-3333-4333-8333-333333333333";

    await repository.save({
      leaseId,
      expectedVersion: 0,
      payload: { schemaVersion: 1, components: [], ouvrages: [] },
    });

    expect(coordinatorSave).toHaveBeenCalledWith({
      resource: LIBRARY_RESOURCE_REF,
      leaseId,
      owner,
      expectedVersion: 0,
      payload: { schemaVersion: 1, components: [], ouvrages: [] },
    });

    await expect(
      repository.save({
        leaseId,
        expectedVersion: 0,
        payload: { schemaVersion: 1, components: [{ bad: true }], ouvrages: [] },
      }),
    ).rejects.toThrow("LIBRARY_STORE_INVALID");
  });

  it("renews and releases only the fixed Library resource", async () => {
    const { repository, locksRenew, coordinatorRelease } = setup();
    const leaseId = "33333333-3333-4333-8333-333333333333";

    await repository.renew(leaseId);
    await repository.release(leaseId);

    expect(locksRenew).toHaveBeenCalledWith({
      resource: LIBRARY_RESOURCE_REF,
      leaseId,
      owner,
    });
    expect(coordinatorRelease).toHaveBeenCalledWith({
      resource: LIBRARY_RESOURCE_REF,
      leaseId,
      owner,
    });
  });
});
