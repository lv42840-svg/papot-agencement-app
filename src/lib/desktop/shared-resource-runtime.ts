import "server-only";

import { NextcloudDavClient } from "@/lib/sync/nextcloud-dav";
import { SharedResourceEditCoordinator } from "@/lib/sync/resource-edit-coordinator";
import { NextcloudResourceLockStore } from "@/lib/sync/resource-lock-store";
import { NextcloudSharedResourceStore } from "@/lib/sync/resource-state-store";

type DesktopRuntimeConfig = {
  nextcloud_base_url: string;
  nextcloud_login: string;
  nextcloud_user_id: string;
  nextcloud_sync_root: string;
  device_id: string;
  papot_user_id: string;
  papot_user_display_name: string;
};

type DesktopSharedResourceRuntime = {
  coordinator: SharedResourceEditCoordinator;
  locks: NextcloudResourceLockStore;
  owner: {
    userId: string;
    deviceId: string;
    displayName: string;
  };
};

let cachedRuntime:
  | {
      rawConfig: string;
      appPassword: string;
      value: DesktopSharedResourceRuntime;
    }
  | undefined;

export function createDesktopSharedResourceRuntime(): DesktopSharedResourceRuntime {
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
    config.papot_user_id,
    config.papot_user_display_name,
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
    owner: {
      userId: config.papot_user_id,
      deviceId: config.device_id,
      displayName: config.papot_user_display_name,
    },
  };

  cachedRuntime = { rawConfig, appPassword, value };
  return value;
}
