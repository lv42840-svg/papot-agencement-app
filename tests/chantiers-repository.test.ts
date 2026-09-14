import { describe, expect, it, vi } from "vitest";
import {
  createInitialChantiersPayload,
  parseChantiersPayload,
} from "../src/lib/chantiers/domain";
import { createNextcloudChantiersRepository } from "../src/lib/chantiers/nextcloud-repository";

const owner = {
  userId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  displayName: "Nadia",
};

type RepositoryParams = Parameters<typeof createNextcloudChantiersRepository>[0];

function envelope(payload: unknown, version = 1) {
  return {
    schema_version: 1 as const,
    resource: { resource_type: "CHANTIER" as const, resource_id: "registry" },
    version,
    updated_at: "2026-09-14T10:00:00.000Z",
    updated_by_user_id: owner.userId,
    updated_by_device_id: owner.deviceId,
    payload,
  };
}

function createRepository(overrides?: {
  cached?: ReturnType<typeof envelope> | null;
  initialPayload?: ReturnType<typeof createInitialChantiersPayload>;
  lockResult?: unknown;
  openResults?: Array<{ resource: ReturnType<typeof envelope> | null; etag: string | null }>;
  saveResults?: unknown[];
}) {
  const initialPayload = overrides?.initialPayload ?? createInitialChantiersPayload();
  const get = vi.fn().mockResolvedValue(envelope(initialPayload));
  const getCached = vi.fn().mockReturnValue(overrides?.cached);
  const openForUpdate = vi.fn();
  for (const result of overrides?.openResults ?? [
    { resource: envelope(initialPayload), etag: "etag-1" },
  ]) {
    openForUpdate.mockResolvedValueOnce(result);
  }

  const saveOpened = vi.fn();
  if (overrides?.saveResults) {
    for (const result of overrides.saveResults) saveOpened.mockResolvedValueOnce(result);
  } else {
    saveOpened.mockImplementation(async ({ payload }: { payload: unknown }) => ({
      status: "saved",
      resource: envelope(payload),
    }));
  }

  const acquire = vi.fn().mockResolvedValue(
    overrides?.lockResult ?? {
      status: "acquired",
      lock: { owner_display_name: owner.displayName },
    },
  );
  const release = vi.fn().mockResolvedValue(true);

  const repository = createNextcloudChantiersRepository({
    desktop: {
      states: { get, getCached, openForUpdate, saveOpened },
      locks: { acquire, release },
    } as unknown as RepositoryParams["desktop"],
    owner,
  });

  return { repository, get, openForUpdate, saveOpened, release };
}

describe("Chantiers repository", () => {
  it("returns cached Chantiers data and refreshes Nextcloud in background", async () => {
    const cachedPayload = createInitialChantiersPayload();
    const { repository, get } = createRepository({ cached: envelope(cachedPayload) });

    await expect(repository.load()).resolves.toEqual(parseChantiersPayload(cachedPayload));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("persists a Chantiers mutation and releases the resource lock", async () => {
    const { repository, saveOpened, release } = createRepository();

    const result = await repository.mutate((payload) => ({ payload }));

    expect(result.payload).toEqual(createInitialChantiersPayload());
    expect(saveOpened).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("reopens and retries once after a storage conflict", async () => {
    const source = createInitialChantiersPayload();
    const { repository, openForUpdate, saveOpened } = createRepository({
      openResults: [
        { resource: envelope(source), etag: "etag-1" },
        { resource: envelope(source, 2), etag: "etag-2" },
      ],
      saveResults: [
        { status: "conflict", current: null },
        { status: "saved", resource: envelope(source, 2) },
      ],
    });
    const transform = vi.fn((payload, isRetry: boolean) => ({
      payload,
      focusChantierId: isRetry ? "33333333-3333-4333-8333-333333333333" : undefined,
    }));

    const result = await repository.mutate(transform);

    expect(result.payload).toEqual(source);
    expect(result.focusChantierId).toBe("33333333-3333-4333-8333-333333333333");
    expect(transform).toHaveBeenNthCalledWith(1, expect.any(Object), false);
    expect(transform).toHaveBeenNthCalledWith(2, expect.any(Object), true);
    expect(openForUpdate).toHaveBeenCalledTimes(2);
    expect(saveOpened).toHaveBeenCalledTimes(2);
  });

  it("surfaces the locking workstation without releasing another device lock", async () => {
    const { repository, release } = createRepository({
      lockResult: { status: "locked", lock: { owner_display_name: "Poste atelier" } },
    });

    await expect(repository.mutate((payload) => ({ payload }))).rejects.toMatchObject({
      message: "CHANTIERS_LOCKED",
      details: { lockedBy: "Poste atelier" },
    });
    expect(release).not.toHaveBeenCalled();
  });

  it("does not write when the transform reports a no-op", async () => {
    const source = createInitialChantiersPayload();
    const { repository, saveOpened, release } = createRepository({ initialPayload: source });

    const result = await repository.mutate((payload) => ({
      payload,
      shouldPersist: false,
    }));

    expect(result.payload).toEqual(source);
    expect(saveOpened).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
