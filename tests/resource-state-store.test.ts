import { describe, expect, it } from "vitest";
import type { ConditionalWriteResult, TextWithEtag } from "../src/lib/sync/nextcloud-dav";
import { NextcloudSharedResourceStore } from "../src/lib/sync/resource-state-store";

const lucien = {
  userId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
};

const nadia = {
  userId: "33333333-3333-4333-8333-333333333333",
  deviceId: "44444444-4444-4444-8444-444444444444",
};

const resource = {
  resource_type: "CHANTIER" as const,
  resource_id: "chantier-dupont",
};

class FakeDav {
  private revision = 0;
  private readonly files = new Map<string, TextWithEtag>();
  raceBeforeNextConditionalWrite = false;

  filesRoot(userId: string): string {
    return `https://nextcloud.test/files/${userId}`;
  }

  childUrl(parentUrl: string, childName: string): string {
    return `${parentUrl}/${encodeURIComponent(childName)}`;
  }

  async ensurePath(rootUrl: string, segments: string[]): Promise<string> {
    return [rootUrl, ...segments.map(encodeURIComponent)].join("/");
  }

  async getTextIfExists(url: string): Promise<string | null> {
    return this.files.get(url)?.text ?? null;
  }

  async getTextWithEtag(url: string): Promise<TextWithEtag | null> {
    return this.files.get(url) ?? null;
  }

  async putTextIfAbsent(url: string, body: string): Promise<ConditionalWriteResult> {
    if (this.files.has(url)) return "precondition-failed";
    this.write(url, body);
    return "written";
  }

  async putTextIfMatch(url: string, body: string, etag: string): Promise<ConditionalWriteResult> {
    if (this.raceBeforeNextConditionalWrite) {
      this.raceBeforeNextConditionalWrite = false;
      const current = this.files.get(url);
      if (current) this.write(url, current.text);
    }

    const current = this.files.get(url);
    if (!current || current.etag !== etag) return "precondition-failed";
    this.write(url, body);
    return "written";
  }

  private write(url: string, text: string): void {
    this.revision += 1;
    this.files.set(url, { text, etag: `\"v${this.revision}\"` });
  }
}

function store(dav = new FakeDav()) {
  return {
    dav,
    resources: new NextcloudSharedResourceStore(dav, "Papot_Appli"),
  };
}

describe("NextcloudSharedResourceStore", () => {
  it("creates version 1 when a shared resource does not exist", async () => {
    const { resources } = store();

    const result = await resources.save({
      resource,
      expectedVersion: 0,
      payload: { title: "Dupont" },
      actor: lucien,
      now: new Date("2026-09-12T15:00:00.000Z"),
    });

    expect(result.status).toBe("saved");
    if (result.status !== "saved") return;
    expect(result.resource.version).toBe(1);
    expect(result.resource.payload).toEqual({ title: "Dupont" });
  });

  it("increments the version after a valid save", async () => {
    const { resources } = store();

    await resources.save({
      resource,
      expectedVersion: 0,
      payload: { title: "Dupont V1" },
      actor: lucien,
    });

    const second = await resources.save({
      resource,
      expectedVersion: 1,
      payload: { title: "Dupont V2" },
      actor: lucien,
    });

    expect(second.status).toBe("saved");
    if (second.status !== "saved") return;
    expect(second.resource.version).toBe(2);
    expect(second.resource.payload).toEqual({ title: "Dupont V2" });
  });

  it("returns the current resource without changing it", async () => {
    const { resources } = store();

    await resources.save({
      resource,
      expectedVersion: 0,
      payload: { title: "Dupont" },
      actor: lucien,
    });

    const current = await resources.get(resource);
    expect(current?.version).toBe(1);
    expect(current?.payload).toEqual({ title: "Dupont" });
  });

  it("refuses a stale save and returns the newer version", async () => {
    const { resources } = store();

    await resources.save({
      resource,
      expectedVersion: 0,
      payload: { title: "V1" },
      actor: lucien,
    });

    await resources.save({
      resource,
      expectedVersion: 1,
      payload: { title: "V2 Lucien" },
      actor: lucien,
    });

    const stale = await resources.save({
      resource,
      expectedVersion: 1,
      payload: { title: "V2 Nadia stale" },
      actor: nadia,
    });

    expect(stale.status).toBe("conflict");
    if (stale.status !== "conflict") return;
    expect(stale.current?.version).toBe(2);
    expect(stale.current?.payload).toEqual({ title: "V2 Lucien" });
  });

  it("refuses an overwrite if Nextcloud changes between read and conditional write", async () => {
    const { dav, resources } = store();

    await resources.save({
      resource,
      expectedVersion: 0,
      payload: { title: "V1" },
      actor: lucien,
    });

    dav.raceBeforeNextConditionalWrite = true;

    const raced = await resources.save({
      resource,
      expectedVersion: 1,
      payload: { title: "Tentative stale" },
      actor: nadia,
    });

    expect(raced.status).toBe("conflict");
    if (raced.status !== "conflict") return;
    expect(raced.current?.version).toBe(1);
  });

  it("does not create a missing resource from a non-zero expected version", async () => {
    const { resources } = store();

    const result = await resources.save({
      resource,
      expectedVersion: 3,
      payload: { title: "Impossible" },
      actor: lucien,
    });

    expect(result).toEqual({ status: "conflict", current: null });
  });
});
