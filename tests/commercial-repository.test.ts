import { describe, expect, it, vi } from "vitest";
import {
  createInitialCommercialPayload,
  parseCommercialPayload,
} from "../src/lib/commercial/domain";
import { applyCommercialMutation } from "../src/lib/commercial/mutations";
import { createNextcloudCommercialRepository } from "../src/lib/commercial/nextcloud-repository";

const owner = {
  userId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  displayName: "Nadia",
};
const actor = { userId: owner.userId, displayName: owner.displayName };

type RepositoryParams = Parameters<typeof createNextcloudCommercialRepository>[0];

function envelope(payload: unknown, version = 1) {
  return {
    schema_version: 1 as const,
    resource: { resource_type: "COMMERCIAL" as const, resource_id: "global" },
    version,
    updated_at: "2026-09-14T08:00:00.000Z",
    updated_by_user_id: owner.userId,
    updated_by_device_id: owner.deviceId,
    payload,
  };
}

function createPistePayload() {
  return applyCommercialMutation(
    createInitialCommercialPayload(),
    {
      action: "create",
      name: "Dupont - cuisine",
      clientName: "Dupont",
      siteLabel: "Roanne",
      description: "",
      nextAction: "",
      reviewDate: "2026-09-20",
    },
    actor,
    new Date("2026-09-14T08:00:00.000Z"),
  ).payload;
}

function createRepository(overrides?: {
  cached?: ReturnType<typeof envelope> | null;
  initialPayload?: ReturnType<typeof createInitialCommercialPayload>;
  lockResult?: unknown;
  openResults?: Array<{ resource: ReturnType<typeof envelope> | null; etag: string | null }>;
  saveResults?: unknown[];
}) {
  const initialPayload = overrides?.initialPayload ?? createInitialCommercialPayload();
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

  const repository = createNextcloudCommercialRepository({
    desktop: {
      states: { get, getCached, openForUpdate, saveOpened },
      locks: { acquire, release },
    } as unknown as RepositoryParams["desktop"],
    owner,
  });

  return { repository, get, openForUpdate, saveOpened, release };
}

describe("Commercial repository", () => {
  it("returns cached Commercial data and refreshes Nextcloud in background", async () => {
    const cachedPayload = createPistePayload();
    const { repository, get } = createRepository({ cached: envelope(cachedPayload) });

    await expect(repository.load()).resolves.toEqual(parseCommercialPayload(cachedPayload));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("persists a Commercial mutation and releases the resource lock", async () => {
    const { repository, saveOpened, release } = createRepository();

    const result = await repository.mutate(() => ({ payload: createPistePayload() }));

    expect(result.payload.cases).toHaveLength(1);
    expect(saveOpened).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("reopens and retries once after a storage conflict", async () => {
    const savedPayload = createPistePayload();
    const { repository, openForUpdate, saveOpened } = createRepository({
      openResults: [
        { resource: envelope(createInitialCommercialPayload()), etag: "etag-1" },
        { resource: envelope(createInitialCommercialPayload()), etag: "etag-2" },
      ],
      saveResults: [
        { status: "conflict", current: null },
        { status: "saved", resource: envelope(savedPayload, 2) },
      ],
    });
    const transform = vi.fn((_payload, isRetry: boolean) => ({
      payload: savedPayload,
      focusCaseId: isRetry ? "33333333-3333-4333-8333-333333333333" : undefined,
    }));

    const result = await repository.mutate(transform);

    expect(result.payload.cases).toHaveLength(1);
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
      message: "COMMERCIAL_LOCKED",
      details: { lockedBy: "Poste atelier" },
    });
    expect(release).not.toHaveBeenCalled();
  });

  it("does not write when the transform reports a no-op", async () => {
    const source = createPistePayload();
    const { repository, saveOpened, release } = createRepository({ initialPayload: source });

    const result = await repository.mutate((payload) => ({
      payload,
      shouldPersist: false,
    }));

    expect(result.payload).toEqual(parseCommercialPayload(source));
    expect(saveOpened).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });
});
