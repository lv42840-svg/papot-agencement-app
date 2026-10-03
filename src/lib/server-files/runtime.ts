import "server-only";

import fs from "node:fs";
import path from "node:path";

import { isLocalStorageMode } from "../local-db/mode";
import { ServerFileStore } from "./storage";

type DesktopFileRuntimeConfig = {
  shared_data_path?: unknown;
};

let cached: { cacheKey: string; store: ServerFileStore } | undefined;

function cachedStore(cacheKey: string, rootPath: string): ServerFileStore {
  if (cached?.cacheKey === cacheKey) return cached.store;

  fs.mkdirSync(rootPath, { recursive: true });
  const store = new ServerFileStore(rootPath);
  cached = { cacheKey, store };
  return store;
}

export function getServerFileStore(): ServerFileStore {
  if (isLocalStorageMode()) {
    const rootPath = path.resolve(
      process.env.PAPOT_LOCAL_FILES_PATH?.trim() || path.join(process.cwd(), ".papot-dev", "files"),
    );
    return cachedStore(`local:${rootPath}`, rootPath);
  }

  const configuredServerRoot = process.env.PAPOT_SERVER_FILES_ROOT?.trim();
  if (configuredServerRoot) {
    if (!path.isAbsolute(configuredServerRoot)) {
      throw new Error("SERVER_FILE_ROOT_INVALID");
    }
    const rootPath = path.resolve(configuredServerRoot);
    return cachedStore(`server:${rootPath}`, rootPath);
  }

  const rawConfig = process.env.PAPOT_DESKTOP_CONFIG_JSON;
  if (!rawConfig) throw new Error("SERVER_FILE_RUNTIME_NOT_CONFIGURED");
  const cacheKey = `desktop:${rawConfig}`;
  if (cached?.cacheKey === cacheKey) return cached.store;

  let config: DesktopFileRuntimeConfig;
  try {
    config = JSON.parse(rawConfig) as DesktopFileRuntimeConfig;
  } catch {
    throw new Error("DESKTOP_RUNTIME_CONFIG_INVALID");
  }

  if (typeof config.shared_data_path !== "string" || !config.shared_data_path.trim()) {
    throw new Error("DESKTOP_SHARED_PATH_REQUIRED");
  }

  const rootPath = path.resolve(config.shared_data_path);
  return cachedStore(cacheKey, rootPath);
}
