import "server-only";

import { createLocalSharedResourceRuntime } from "../local-db/shared-resources";
import { isLocalStorageMode } from "../local-db/runtime";
import { NextcloudDavClient } from "../sync/nextcloud-dav";
import { SharedResourceEditCoordinator } from "../sync/resource-edit-coordinator";
import { NextcloudResourceLockStore } from "../sync/resource-lock-store";
import { NextcloudSharedResourceStore } from "../sync/resource-state-store";

type DesktopRuntimeConfig = {
  nextcloud_base_url: string;
  nextcloud_login: string;
  nextcloud_user_id: string;
  nextcloud_sync_root: string;
  device_id: string;
};

export type DesktopSharedResourceRuntime = {
  coordinator: SharedResourceEditCoordinator;
  locks: NextcloudResourceLockStore;
  states: NextcloudSharedResourceStore;
  dav: NextcloudDavClient;
  nextcloudUserId: string;
  syncRoot: string;
  deviceId: string;
};

let cachedRuntime:
  | {
      rawConfig: string;
      appPassword: string;
      value: DesktopSharedResourceRuntime;
    }
  | undefined;

function serverDeviceId(): string {
  const value = process.env.PAPOT_SERVER_DEVICE_ID?.trim();
  if (!value) throw new Error("PAPOT_SERVER_DEVICE_ID_REQUIRED");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("PAPOT_SERVER_DEVICE_ID_INVALID");
  }
  return value;
}

export function createDesktopSharedResourceRuntime(): DesktopSharedResourceRuntime {
  if (isLocalStorageMode()) {
    const local = createLocalSharedResourceRuntime();
    return {
      coordinator: local.coordinator,
      locks: local.locks,
      states: local.states,
      dav: null,
      nextcloudUserId: "local",
      syncRoot: "LOCAL",
      deviceId: local.deviceId,
    } as unknown as DesktopSharedResourceRuntime;
  }

  if ((process.env.PAPOT_STORAGE_MODE ?? "").trim().toLowerCase() === "postgres") {
    const local = createLocalSharedResourceRuntime();
    return {
      coordinator: local.coordinator,
      locks: local.locks,
      states: local.states,
      dav: null,
      nextcloudUserId: "web",
      syncRoot: "WEB",
      deviceId: serverDeviceId(),
    } as unknown as DesktopSharedResourceRuntime;
  }

  const rawConfig = process.env.PAPOT_DESKTOP_CONFIG_JSON;
  const appPassword = process.env.PAPOT_NEXTCLOUD_APP_PASSWORD;
  if (!rawConfig || !appPassword) throw new Error("DESKTOP_RUNTIME_NOT_CONFIGURED");

  if (
    cachedRuntime &&
    cachedRuntime.rawConfig === rawConfig &&
    cachedRuntime.appPassword === appPassword
  ) {
    return cachedRuntime.value;
  }

  let config: DesktopRuntimeConfig;
  try {
    config = JSON.parse(rawConfig) as DesktopRuntimeConfig;
  } catch {
    throw new Error("DESKTOP_RUNTIME_CONFIG_INVALID");
  }

  const required = [
    config.nextcloud_base_url,
    config.nextcloud_login,
    config.nextcloud_user_id,
    config.nextcloud_sync_root,
    config.device_id,
  ];
  if (required.some((value) => typeof value !== "string" || !value.trim())) {
    throw new Error("DESKTOP_RUNTIME_CONFIG_INVALID");
  }

  const dav = new NextcloudDavClient({
    baseUrl: config.nextcloud_base_url,
    login: config.nextcloud_login,
    appPassword,
    userAgent: "PAPOT-Desktop/0.1",
  });
  const locks = new NextcloudResourceLockStore(
    dav,
    config.nextcloud_user_id,
    config.nextcloud_sync_root,
  );
  const states = new NextcloudSharedResourceStore(
    dav,
    config.nextcloud_user_id,
    config.nextcloud_sync_root,
  );

  const value = {
    coordinator: new SharedResourceEditCoordinator(locks, states),
    locks,
    states,
    dav,
    nextcloudUserId: config.nextcloud_user_id,
    syncRoot: config.nextcloud_sync_root,
    deviceId: config.device_id,
  };

  cachedRuntime = { rawConfig, appPassword, value };
  return value;
}
