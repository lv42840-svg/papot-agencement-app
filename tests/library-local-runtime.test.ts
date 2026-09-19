import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const runtime = readFileSync(
  new URL("../src/lib/desktop/shared-resource-runtime.ts", import.meta.url),
  "utf8",
);
const createRepository = readFileSync(
  new URL("../src/lib/library/create-repository.ts", import.meta.url),
  "utf8",
);
const sharedRepository = readFileSync(
  new URL("../src/lib/library/shared-resource-repository.ts", import.meta.url),
  "utf8",
);
const nextcloudAlias = readFileSync(
  new URL("../src/lib/library/nextcloud-repository.ts", import.meta.url),
  "utf8",
);

describe("Library local storage contract", () => {
  it("routes local mode to the SQLite shared-resource runtime without Nextcloud DAV", () => {
    expect(runtime).toContain("if (isLocalStorageMode())");
    expect(runtime).toContain("createLocalSharedResourceRuntime()");
    expect(runtime).toContain("dav: null");
    expect(runtime).toContain('nextcloudUserId: "local"');
    expect(runtime).toContain('syncRoot: "LOCAL"');
  });

  it("uses the transport-neutral Library repository in local mode", () => {
    expect(createRepository).toContain("createSharedResourceLibraryRepository");
    expect(createRepository).toContain("if (isLocalStorageMode())");
    expect(createRepository).not.toContain("createNextcloudLibraryRepository(context)");
    expect(sharedRepository).toContain("params.desktop.states");
    expect(sharedRepository).toContain("params.desktop.coordinator");
    expect(sharedRepository).toContain("params.desktop.locks");
  });

  it("keeps the historical Nextcloud repository name only as a compatibility alias", () => {
    expect(nextcloudAlias).toContain(
      "createSharedResourceLibraryRepository as createNextcloudLibraryRepository",
    );
    expect(nextcloudAlias).not.toContain("NextcloudLibraryStore");
  });
});
