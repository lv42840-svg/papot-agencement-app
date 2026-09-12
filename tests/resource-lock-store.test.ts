import { describe, expect, it } from "vitest";
import type {
  ConditionalDeleteResult,
  ConditionalWriteResult,
  TextWithEtag,
} from "../src/lib/sync/nextcloud-dav";
import { NextcloudResourceLockStore } from "../src/lib/sync/resource-lock-store";

const lucien = {
  userId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  displayName: "Lucien",
};

const nadia = {
  userId: "33333333-3333-4333-8333-333333333333",
  deviceId: "44444444-4444-4444-8444-444444444444",
  displayName: "Nadia",
};

const resource = {
  resource_type: "CHANTIER" as const,
  resource_id: "chantier-dupont",
};

class FakeDav {
  private revision = 0;
  private readonly files = new Map<string, TextWithEtag>();

  filesRoot(userId: string): string {
    return `https://nextcloud.test/files/${userId}`;
  }

  childUrl(parentUrl: string, childName: string): string {
    return `${parentUrl}/${encodeURIComponent(childName)}`;
  }

  async ensurePath(rootUrl: string, segments: string[]): Promise<string> {
    return [rootUrl, ...segments.map(encodeURIComponent)].join("/");
  }

  async getTextWithEtag(url: string): Promise<TextWithEtag | null> {
    return this.files.get(url) ?? null;
  }

  async putTextIfAbsent(url: string, body: string): Promise<ConditionalWriteResult> {
    if (this.files.has(url)) return "precondition-failed";
    this.write(url, body);
    return "written";
  }

  async putTextIfMatch(
    url: string,
    body: string,
    etag: string,
  ): Promise<ConditionalWriteResult> {
    const current = this.files.get(url);
    if (!current || current.etag !== etag) return "precondition-failed";
    this.write(url, body);
    return "written";
  }

  async deleteIfMatch(url: string, etag: string): Promise<ConditionalDeleteResult> {
    const current = this.files.get(url);
    if (!current) return "missing";
    if (current.etag !== etag) return "precondition-failed";
    this.files.delete(url);
    return "deleted";
  }

  private write(url: string, text: string): void {
    this.revision += 1;
    this.files.set(url, { text, etag: `\"v${this.revision}\"` });
  }
}

function store(dav = new FakeDav()) {
  return {
    dav,
    locks: new NextcloudResourceLockStore(dav, "Papot_Appli"),
  };
}

describe("NextcloudResourceLockStore", () => {
  it("lets the first user acquire a chantier lock", async () => {
    const { locks } = store();
    const now = new Date("2026-09-12T15:00:00.000Z");

    const result = await locks.acquire({
      resource,
      leaseId: "55555555-5555-4555-8555-555555555555",
      owner: lucien,
      baseVersion: 12,
      now,
    });

    expect(result.status).toBe("acquired");
    expect(result.lock.owner_display_name).toBe("Lucien");
    expect(result.lock.base_version).toBe(12);
  });

  it("puts a second user in read-only mode while the first lease is active", async () => {
    const { locks } = store();
    const now = new Date("2026-09-12T15:00:00.000Z");

    await locks.acquire({
      resource,
      leaseId: "55555555-5555-4555-8555-555555555555",
      owner: lucien,
      baseVersion: 12,
      now,
    });

    const second = await locks.acquire({
      resource,
      leaseId: "66666666-6666-4666-8666-666666666666",
      owner: nadia,
      baseVersion: 12,
      now: new Date(now.getTime() + 30_000),
    });

    expect(second.status).toBe("locked");
    expect(second.lock.owner_display_name).toBe("Lucien");
  });

  it("lets another user take over only after the old lease has expired", async () => {
    const { locks } = store();
    const now = new Date("2026-09-12T15:00:00.000Z");

    await locks.acquire({
      resource,
      leaseId: "55555555-5555-4555-8555-555555555555",
      owner: lucien,
      baseVersion: 12,
      now,
      ttlMs: 1_000,
    });

    const takeover = await locks.acquire({
      resource,
      leaseId: "66666666-6666-4666-8666-666666666666",
      owner: nadia,
      baseVersion: 12,
      now: new Date(now.getTime() + 1_001),
    });

    expect(takeover.status).toBe("acquired");
    expect(takeover.lock.owner_display_name).toBe("Nadia");
  });

  it("renews an owned active lease without changing who owns it", async () => {
    const { locks } = store();
    const now = new Date("2026-09-12T15:00:00.000Z");
    const leaseId = "55555555-5555-4555-8555-555555555555";

    await locks.acquire({
      resource,
      leaseId,
      owner: lucien,
      baseVersion: 12,
      now,
    });

    const renewed = await locks.renew({
      resource,
      leaseId,
      owner: lucien,
      now: new Date(now.getTime() + 60_000),
    });

    expect(renewed.owner_display_name).toBe("Lucien");
    expect(renewed.acquired_at).toBe(now.toISOString());
    expect(Date.parse(renewed.expires_at)).toBe(now.getTime() + 6 * 60_000);
  });

  it("allows the owner to release the lock and another user to acquire it", async () => {
    const { locks } = store();
    const now = new Date("2026-09-12T15:00:00.000Z");
    const leaseId = "55555555-5555-4555-8555-555555555555";

    await locks.acquire({
      resource,
      leaseId,
      owner: lucien,
      baseVersion: 12,
      now,
    });

    await expect(
      locks.release({ resource, leaseId, owner: lucien }),
    ).resolves.toBe(true);

    const second = await locks.acquire({
      resource,
      leaseId: "66666666-6666-4666-8666-666666666666",
      owner: nadia,
      baseVersion: 12,
      now: new Date(now.getTime() + 1_000),
    });

    expect(second.status).toBe("acquired");
    expect(second.lock.owner_display_name).toBe("Nadia");
  });

  it("refuses to release a lock owned by someone else", async () => {
    const { locks } = store();
    const now = new Date("2026-09-12T15:00:00.000Z");

    await locks.acquire({
      resource,
      leaseId: "55555555-5555-4555-8555-555555555555",
      owner: lucien,
      baseVersion: 12,
      now,
    });

    await expect(
      locks.release({
        resource,
        leaseId: "66666666-6666-4666-8666-666666666666",
        owner: nadia,
      }),
    ).rejects.toThrow("LOCK_NOT_OWNED");
  });
});
