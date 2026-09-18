import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDesktopSharedResourceRuntime } from "../src/lib/desktop/shared-resource-runtime";
import { createLibraryRepository } from "../src/lib/library/create-repository";

const originalStorageMode = process.env.PAPOT_STORAGE_MODE;
const originalLocalDbPath = process.env.PAPOT_LOCAL_DB_PATH;
const originalDesktopConfig = process.env.PAPOT_DESKTOP_CONFIG_JSON;
const originalNextcloudPassword = process.env.PAPOT_NEXTCLOUD_APP_PASSWORD;
const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "papot-library-local-"));

afterAll(() => {
  if (originalStorageMode === undefined) delete process.env.PAPOT_STORAGE_MODE;
  else process.env.PAPOT_STORAGE_MODE = originalStorageMode;
  if (originalLocalDbPath === undefined) delete process.env.PAPOT_LOCAL_DB_PATH;
  else process.env.PAPOT_LOCAL_DB_PATH = originalLocalDbPath;
  if (originalDesktopConfig === undefined) delete process.env.PAPOT_DESKTOP_CONFIG_JSON;
  else process.env.PAPOT_DESKTOP_CONFIG_JSON = originalDesktopConfig;
  if (originalNextcloudPassword === undefined) delete process.env.PAPOT_NEXTCLOUD_APP_PASSWORD;
  else process.env.PAPOT_NEXTCLOUD_APP_PASSWORD = originalNextcloudPassword;
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

describe("Library local shared-resource runtime", () => {
  it("loads and saves the library without any Nextcloud configuration", async () => {
    process.env.PAPOT_STORAGE_MODE = "local";
    process.env.PAPOT_LOCAL_DB_PATH = path.join(tempDirectory, "papot.sqlite");
    delete process.env.PAPOT_DESKTOP_CONFIG_JSON;
    delete process.env.PAPOT_NEXTCLOUD_APP_PASSWORD;

    const desktop = createDesktopSharedResourceRuntime();
    expect(desktop.nextcloudUserId).toBe("local");
    expect(desktop.syncRoot).toBe("LOCAL");
    expect(desktop.dav).toBeNull();

    const owner = {
      userId: "11111111-1111-4111-8111-111111111111",
      deviceId: desktop.deviceId,
      displayName: "Test User",
    };
    const repository = createLibraryRepository({ desktop, owner });

    await expect(repository.load()).resolves.toEqual({
      version: 0,
      payload: { schemaVersion: 1, components: [], ouvrages: [] },
    });

    const leaseId = randomUUID();
    const opened = await repository.open(leaseId);
    expect(opened.status).toBe("editable");

    const saved = await repository.save({
      leaseId,
      expectedVersion: opened.baseVersion,
      payload: { schemaVersion: 1, components: [], ouvrages: [] },
    });
    expect(saved.status).toBe("saved");

    await expect(repository.load()).resolves.toEqual({
      version: 1,
      payload: { schemaVersion: 1, components: [], ouvrages: [] },
    });
    await expect(repository.release(leaseId)).resolves.toBe(true);
  });
});
