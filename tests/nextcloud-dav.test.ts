import { afterEach, describe, expect, it, vi } from "vitest";

import { NextcloudDavClient } from "../src/lib/sync/nextcloud-dav";

describe("NextcloudDavClient collection cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("verifies each collection only once for repeated paths", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 207 }));
    vi.stubGlobal("fetch", fetchMock);
    const dav = new NextcloudDavClient({
      baseUrl: "https://cloud.example.test",
      login: "technical-account",
      appPassword: "not-a-real-secret",
    });
    const root = dav.filesRoot("papot-user");

    await dav.ensurePath(root, ["PAPOT_SYNC", "shared", "chantier"]);
    await dav.ensurePath(root, ["PAPOT_SYNC", "shared", "chantier"]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("shares in-flight collection checks between concurrent paths", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 207 }));
    vi.stubGlobal("fetch", fetchMock);
    const dav = new NextcloudDavClient({
      baseUrl: "https://cloud.example.test",
      login: "technical-account",
      appPassword: "not-a-real-secret",
    });
    const root = dav.filesRoot("papot-user");

    await Promise.all([
      dav.ensurePath(root, ["PAPOT_SYNC", "shared", "chantier"]),
      dav.ensurePath(root, ["PAPOT_SYNC", "shared", "chantier"]),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a collection check after a transient failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 207 }));
    vi.stubGlobal("fetch", fetchMock);
    const dav = new NextcloudDavClient({
      baseUrl: "https://cloud.example.test",
      login: "technical-account",
      appPassword: "not-a-real-secret",
    });
    const collection = dav.childUrl(dav.filesRoot("papot-user"), "PAPOT_SYNC");

    await expect(dav.ensureCollection(collection)).rejects.toThrow("WEBDAV_PROPFIND_HTTP_503");
    await expect(dav.ensureCollection(collection)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
