import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDesktopSharedResourceRuntime } from "../src/lib/desktop/shared-resource-runtime";

const previousStorageMode = process.env.PAPOT_STORAGE_MODE;
const previousDesktopConfig = process.env.PAPOT_DESKTOP_CONFIG_JSON;
const previousPassword = process.env.PAPOT_NEXTCLOUD_APP_PASSWORD;
const previousDeviceId = process.env.PAPOT_SERVER_DEVICE_ID;

afterEach(() => {
  if (previousStorageMode === undefined) delete process.env.PAPOT_STORAGE_MODE;
  else process.env.PAPOT_STORAGE_MODE = previousStorageMode;

  if (previousDesktopConfig === undefined) delete process.env.PAPOT_DESKTOP_CONFIG_JSON;
  else process.env.PAPOT_DESKTOP_CONFIG_JSON = previousDesktopConfig;

  if (previousPassword === undefined) delete process.env.PAPOT_NEXTCLOUD_APP_PASSWORD;
  else process.env.PAPOT_NEXTCLOUD_APP_PASSWORD = previousPassword;

  if (previousDeviceId === undefined) delete process.env.PAPOT_SERVER_DEVICE_ID;
  else process.env.PAPOT_SERVER_DEVICE_ID = previousDeviceId;
});

describe("web request compatibility runtime", () => {
  it("builds in PostgreSQL mode without desktop or Nextcloud configuration", () => {
    process.env.PAPOT_STORAGE_MODE = "postgres";
    process.env.PAPOT_SERVER_DEVICE_ID = "11111111-1111-4111-8111-111111111111";
    delete process.env.PAPOT_DESKTOP_CONFIG_JSON;
    delete process.env.PAPOT_NEXTCLOUD_APP_PASSWORD;

    const runtime = createDesktopSharedResourceRuntime();

    expect(runtime.deviceId).toBe("11111111-1111-4111-8111-111111111111");
    expect(runtime.nextcloudUserId).toBe("web");
    expect(runtime.syncRoot).toBe("WEB");
    expect(runtime.dav).toBeNull();
  });

  it("requires a stable server device id in PostgreSQL mode", () => {
    process.env.PAPOT_STORAGE_MODE = "postgres";
    delete process.env.PAPOT_SERVER_DEVICE_ID;
    delete process.env.PAPOT_DESKTOP_CONFIG_JSON;
    delete process.env.PAPOT_NEXTCLOUD_APP_PASSWORD;

    expect(() => createDesktopSharedResourceRuntime()).toThrow("PAPOT_SERVER_DEVICE_ID_REQUIRED");
  });
});
