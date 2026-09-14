import { describe, expect, it, vi } from "vitest";
import { createInitialClientsPayload } from "../src/lib/clients/domain";
import { applyClientsMutation } from "../src/lib/clients/mutations";
import { createNextcloudClientsRepository } from "../src/lib/clients/nextcloud-repository";

const owner = {
  userId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  displayName: "Test User",
};
const actor = { userId: owner.userId, displayName: owner.displayName };
const clientId = "33333333-3333-4333-8333-333333333333";

const createInput = {
  action: "create" as const,
  clientId,
  type: "ENTREPRISE" as const,
  companyName: "Test Agencement",
  firstName: "",
  lastName: "",
  addressLine1: "12 rue des Ateliers",
  addressLine2: "",
  postalCode: "42300",
  city: "Roanne",
  phone: "04 77 00 00 00",
  email: "contact@example.test",
  siret: "12345678901234",
  paymentTerms: "45 jours fin de mois",
  notes: "Client test",
  contacts: [],
};

type RepositoryParams = Parameters<typeof createNextcloudClientsRepository>[0];

function envelope(payload: unknown, version = 1) {
  return {
    schema_version: 1 as const,
    resource: { resource_type: "CLIENTS" as const, resource_id: "global" },
    version,
    updated_at: "2026-09-14T07:00:00.000Z",
    updated_by_user_id: owner.userId,
    updated_by_device_id: owner.deviceId,
    payload,
  };
}

function createRepository(overrides?: {
  cached?: ReturnType<typeof envelope> | null;
  lockResult?: unknown;
  openResults?: Array<{ resource: ReturnType<typeof envelope> | null; etag: string | null }>;
  saveResults?: unknown[];
}) {
  const get = vi.fn().mockResolvedValue(envelope(createInitialClientsPayload()));
  const getCached = vi.fn().mockReturnValue(overrides?.cached);
  const openForUpdate = vi.fn();
  for (const result of overrides?.openResults ?? [{ resource: null, etag: null }]) {
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

  const repository = createNextcloudClientsRepository({
    states: { get, getCached, openForUpdate, saveOpened } as unknown as RepositoryParams["states"],
    locks: { acquire, release } as unknown as RepositoryParams["locks"],
    owner,
  });

  return { repository, get, openForUpdate, saveOpened, release };
}

describe("clients repository", () => {
  it("returns the cached payload and refreshes Nextcloud in background", async () => {
    const cachedPayload = createInitialClientsPayload();
    const { repository, get } = createRepository({ cached: envelope(cachedPayload) });

    await expect(repository.load()).resolves.toEqual(cachedPayload);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("applies a mutation through the Nextcloud adapter and releases the lock", async () => {
    const { repository, saveOpened, release } = createRepository();

    const result = await repository.mutate(createInput, actor);

    expect(result.payload.clients).toHaveLength(1);
    expect(result.payload.clients[0].id).toBe(clientId);
    expect(saveOpened).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("reopens and retries once after a storage conflict", async () => {
    const secondSavedPayload = applyClientsMutation(
      createInitialClientsPayload(),
      createInput,
      actor,
      new Date("2026-09-14T07:00:00.000Z"),
    ).payload;
    const { repository, openForUpdate, saveOpened } = createRepository({
      openResults: [
        { resource: null, etag: null },
        { resource: null, etag: null },
      ],
      saveResults: [
        { status: "conflict", current: null },
        { status: "saved", resource: envelope(secondSavedPayload, 2) },
      ],
    });

    const result = await repository.mutate(createInput, actor);

    expect(result.payload.clients[0].id).toBe(clientId);
    expect(openForUpdate).toHaveBeenCalledTimes(2);
    expect(saveOpened).toHaveBeenCalledTimes(2);
  });

  it("surfaces who owns a lock without releasing another device lock", async () => {
    const { repository, release } = createRepository({
      lockResult: { status: "locked", lock: { owner_display_name: "Other User" } },
    });

    await expect(repository.mutate(createInput, actor)).rejects.toMatchObject({
      message: "CLIENTS_LOCKED",
      details: { lockedBy: "Other User" },
    });
    expect(release).not.toHaveBeenCalled();
  });
});
