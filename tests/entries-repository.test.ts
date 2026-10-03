import { describe, expect, it, vi } from "vitest";
import { createInitialEntriesPayload, type EntryAttachment } from "../src/lib/entries/domain";
import { applyEntriesMutation } from "../src/lib/entries/mutations";
import { createNextcloudEntriesRepository } from "../src/lib/entries/nextcloud-repository";

const owner = {
  userId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  displayName: "Nadia",
};
const actor = {
  userId: owner.userId,
  displayName: owner.displayName,
  canQualify: true,
  canManageTags: true,
};
const entryId = "33333333-3333-4333-8333-333333333333";
const createInput = {
  action: "create" as const,
  entryId,
  rawText: "Préparer le devis atelier",
  priority: "NORMAL" as const,
  tagIds: ["devis"],
};
const attachment: EntryAttachment = {
  id: "44444444-4444-4444-8444-444444444444",
  fileName: "plan.pdf",
  contentType: "application/pdf",
  sizeBytes: 1234,
  sha256: "a".repeat(64),
  storagePath: "documents/entries/test/plan.pdf",
  uploadedAt: "2026-09-14T08:00:00.000Z",
  uploadedByName: "Nadia",
};

type RepositoryParams = Parameters<typeof createNextcloudEntriesRepository>[0];

function envelope(payload: unknown, version = 1) {
  return {
    schema_version: 1 as const,
    resource: { resource_type: "ENTRIES" as const, resource_id: "global" },
    version,
    updated_at: "2026-09-14T08:00:00.000Z",
    updated_by_user_id: owner.userId,
    updated_by_device_id: owner.deviceId,
    payload,
  };
}

function createRepository(overrides?: {
  cached?: ReturnType<typeof envelope> | null;
  initialPayload?: ReturnType<typeof createInitialEntriesPayload>;
  lockResult?: unknown;
  openResults?: Array<{ resource: ReturnType<typeof envelope> | null; etag: string | null }>;
  saveResults?: unknown[];
}) {
  const initialPayload = overrides?.initialPayload ?? createInitialEntriesPayload();
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

  const repository = createNextcloudEntriesRepository({
    desktop: {
      states: { get, getCached, openForUpdate, saveOpened },
      locks: { acquire, release },
    } as unknown as RepositoryParams["desktop"],
    owner,
  });

  return { repository, get, openForUpdate, saveOpened, release };
}

describe("entries repository", () => {
  it("returns the cached payload and refreshes Nextcloud in background", async () => {
    const cachedPayload = createInitialEntriesPayload();
    const { repository, get } = createRepository({ cached: envelope(cachedPayload) });

    await expect(repository.load()).resolves.toEqual(cachedPayload);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("applies an Entries mutation and releases the resource lock", async () => {
    const { repository, saveOpened, release } = createRepository();

    const result = await repository.mutate(createInput, actor);

    expect(result.payload.entries[0].id).toBe(entryId);
    expect(saveOpened).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("reopens and retries once after a storage conflict", async () => {
    const savedPayload = applyEntriesMutation(
      createInitialEntriesPayload(),
      createInput,
      actor,
      new Date("2026-09-14T08:00:00.000Z"),
    ).payload;
    const { repository, openForUpdate, saveOpened } = createRepository({
      openResults: [
        { resource: envelope(createInitialEntriesPayload()), etag: "etag-1" },
        { resource: envelope(createInitialEntriesPayload()), etag: "etag-2" },
      ],
      saveResults: [
        { status: "conflict", current: null },
        { status: "saved", resource: envelope(savedPayload, 2) },
      ],
    });

    const result = await repository.mutate(createInput, actor);

    expect(result.payload.entries[0].id).toBe(entryId);
    expect(openForUpdate).toHaveBeenCalledTimes(2);
    expect(saveOpened).toHaveBeenCalledTimes(2);
  });

  it("surfaces an Entries lock without releasing another device lock", async () => {
    const { repository, release } = createRepository({
      lockResult: { status: "locked", lock: { owner_display_name: "Autre poste" } },
    });

    await expect(repository.mutate(createInput, actor)).rejects.toThrow("ENTRIES_LOCKED");
    expect(release).not.toHaveBeenCalled();
  });

  it("registers attachment metadata through the same repository boundary", async () => {
    const payloadWithEntry = applyEntriesMutation(
      createInitialEntriesPayload(),
      createInput,
      actor,
      new Date("2026-09-14T08:00:00.000Z"),
    ).payload;
    const { repository, release } = createRepository({ initialPayload: payloadWithEntry });

    const result = await repository.registerAttachments(entryId, [attachment], actor);

    expect(result.payload.entries[0].attachments).toEqual([attachment]);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
