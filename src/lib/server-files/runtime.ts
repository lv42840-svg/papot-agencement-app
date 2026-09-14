import "server-only";

import { ServerFileStore } from "./storage";

type DesktopFileRuntimeConfig = {
  shared_data_path?: unknown;
};

let cached: { rawConfig: string; store: ServerFileStore } | undefined;

export function getServerFileStore(): ServerFileStore {
  const rawConfig = process.env.PAPOT_DESKTOP_CONFIG_JSON;
  if (!rawConfig) throw new Error("DESKTOP_RUNTIME_NOT_CONFIGURED");
  if (cached?.rawConfig === rawConfig) return cached.store;

  let config: DesktopFileRuntimeConfig;
  try {
    config = JSON.parse(rawConfig) as DesktopFileRuntimeConfig;
  } catch {
    throw new Error("DESKTOP_RUNTIME_CONFIG_INVALID");
  }

  if (typeof config.shared_data_path !== "string" || !config.shared_data_path.trim()) {
    throw new Error("DESKTOP_SHARED_PATH_REQUIRED");
  }

  const store = new ServerFileStore(config.shared_data_path);
  cached = { rawConfig, store };
  return store;
}
