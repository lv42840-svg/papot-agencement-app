import { describe, expect, it } from "vitest";
import type { ConditionalWriteResult, TextWithEtag } from "../src/lib/sync/nextcloud-dav";
import { resourceLockPathSegments } from "../src/lib/sync/resource-lock";
import { NextcloudSharedResourceStore } from "../src/lib/sync/resource-state-store";
import {
  LIBRARY_RESOURCE_REF,
  NextcloudLibraryStore,
  parseLibraryPayload,
} from "../src/lib/library/storage";

const actor = {
  userId: "55555555-5555-4555-8555-555555555555",
  deviceId: "66666666-6666-4666-8666-666666666666",
};

class FakeDav {
  private revision = 0;
  private readonly files = new Map<string, TextWithEtag>();
  lastWrittenUrl: string | null = null;

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
    const current = this.files.get(url);
    if (!current || current.etag !== etag) return "precondition-failed";
    this.write(url, body);
    return "written";
  }

  private write(url: string, text: string): void {
    this.revision += 1;
    this.lastWrittenUrl = url;
    this.files.set(url, { text, etag: `\"v${this.revision}\"` });
  }
}

function examplePayload() {
  return {
    schemaVersion: 1 as const,
    components: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Panneau mélaminé blanc",
        description: "",
        unit: "m²",
        costPriceCents: 10_000,
        marginPercent: 30,
        salePriceCents: 13_000,
      },
    ],
    ouvrages: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Meuble bas mélaminé 2 portes",
        description: "",
        components: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            componentId: "11111111-1111-4111-8111-111111111111",
            quantity: 2.5,
          },
        ],
      },
    ],
  };
}

function setup() {
  const dav = new FakeDav();
  const resources = new NextcloudSharedResourceStore(dav, "Lulu");
  return {
    dav,
    library: new NextcloudLibraryStore(resources),
  };
}

describe("Nextcloud Library storage", () => {
  it("returns an empty version zero library before the first save", async () => {
    const { library } = setup();

    await expect(library.get()).resolves.toEqual({
      version: 0,
      payload: { schemaVersion: 1, components: [], ouvrages: [] },
    });
  });

  it("stores and reloads the Library through the shared Nextcloud JSON resource", async () => {
    const { dav, library } = setup();
    const payload = examplePayload();

    const saved = await library.save({
      expectedVersion: 0,
      payload,
      actor,
      now: new Date("2026-09-14T04:00:00.000Z"),
    });

    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") return;
    expect(saved.library).toEqual({ version: 1, payload });
    expect(dav.lastWrittenUrl).toBe(
      "https://nextcloud.test/files/Lulu/PAPOT_SYNC/shared/library/catalog.json",
    );
    await expect(library.get()).resolves.toEqual({ version: 1, payload });
  });

  it("increments versions and refuses a stale Library save", async () => {
    const { library } = setup();
    const payload = examplePayload();

    await library.save({ expectedVersion: 0, payload, actor });
    const updated = {
      ...payload,
      components: [{ ...payload.components[0], name: "Panneau blanc V2" }],
    };

    const second = await library.save({ expectedVersion: 1, payload: updated, actor });
    expect(second.status).toBe("saved");
    if (second.status !== "saved") return;
    expect(second.library.version).toBe(2);

    const stale = await library.save({ expectedVersion: 1, payload, actor });
    expect(stale.status).toBe("conflict");
    if (stale.status !== "conflict") return;
    expect(stale.current).toEqual({ version: 2, payload: updated });
  });

  it("keeps component pricing rules when validating persisted Library data", () => {
    const payload = examplePayload();
    payload.components[0].salePriceCents = 12_999;

    expect(() => parseLibraryPayload(payload)).toThrow("LIBRARY_COMPONENT_PRICING_MISMATCH");
  });

  it("rejects an ouvrage that references a component missing from the Library", () => {
    const payload = examplePayload();
    payload.ouvrages[0].components[0].componentId =
      "44444444-4444-4444-8444-444444444444";

    expect(() => parseLibraryPayload(payload)).toThrow("LIBRARY_OUVRAGE_COMPONENT_NOT_FOUND");
  });

  it("rejects duplicate component and ouvrage identities", () => {
    const componentDuplicate = examplePayload();
    componentDuplicate.components.push({ ...componentDuplicate.components[0] });
    expect(() => parseLibraryPayload(componentDuplicate)).toThrow("LIBRARY_COMPONENT_ID_DUPLICATE");

    const ouvrageDuplicate = examplePayload();
    ouvrageDuplicate.ouvrages.push({ ...ouvrageDuplicate.ouvrages[0] });
    expect(() => parseLibraryPayload(ouvrageDuplicate)).toThrow("LIBRARY_OUVRAGE_ID_DUPLICATE");
  });

  it("uses the generic shared-resource lock namespace for the Library", () => {
    expect(resourceLockPathSegments(LIBRARY_RESOURCE_REF)).toEqual([
      "locks",
      "library",
      "catalog.json",
    ]);
  });
});
