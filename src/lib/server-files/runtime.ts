import "server-only";

import fs from "node:fs";
import path from "node:path";

import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { ServerFileStore } from "./storage";

type DesktopFileRuntimeConfig = {
  shared_data_path?: unknown;
};

let cached: { cacheKey: string; store: ServerFileStore } | undefined;

export function getServerFileStore(): ServerFileStore {
  if (isLocalStorageMode()) {
    const rootPath = path.resolve(
      process.env.PAPOT_LOCAL_FILES_PATH?.trim() || path.join(process.cwd(), ".papot-dev", "files"),
    );
    const cacheKey = `local:${rootPath}`;
    if (cached?.cacheKey === cacheKey) return cached.store;

    fs.mkdirSync(rootPath, { recursive: true });
    const store = new ServerFileStore(rootPath);
    cached = { cacheKey, store };
    return store;
  }

  const rawConfig = process.env.PAPOT_DESKTOP_CONFIG_JSON;
  if (!rawConfig) throw new Error("DESKTOP_RUNTIME_NOT_CONFIGURED");
  const cacheKey = `server:${rawConfig}`;
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

  const store = new ServerFileStore(config.shared_data_path);
  cached = { cacheKey, store };
  return store;
}
