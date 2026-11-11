import "server-only";

import fs from "node:fs";
import path from "node:path";

import { isLocalStorageMode } from "../local-db/mode";
import { ServerFileStore } from "./storage";

type DesktopFileRuntimeConfig = {
  shared_data_path?: unknown;
};

let cache: { cacheKey: string; store: ServerFileStore } | undefined;

function cachedStore(cleCache: string, cheminRacine: string): ServerFileStore {
  if (cache?.cacheKey === cleCache) return cache.store;

  fs.mkdirSync(cheminRacine, { recursive: true });
  const stockage = new ServerFileStore(cheminRacine);
  cache = { cacheKey: cleCache, store: stockage };
  return stockage;
}

export function getServerFileStore(): ServerFileStore {
  if (isLocalStorageMode()) {
    const cheminRacine = path.resolve(
      process.env.PAPOT_LOCAL_FILES_PATH?.trim() || path.join(process.cwd(), ".papot-dev", "files"),
    );
    return cachedStore(`local:${cheminRacine}`, cheminRacine);
  }

  const racineServeurConfiguree = process.env.PAPOT_SERVER_FILES_ROOT?.trim();
  if (racineServeurConfiguree) {
    if (!path.isAbsolute(racineServeurConfiguree)) {
      throw new Error("SERVER_FILE_ROOT_INVALID");
    }
    const cheminRacine = path.resolve(racineServeurConfiguree);
    return cachedStore(`server:${cheminRacine}`, cheminRacine);
  }

  const configurationBrute = process.env.PAPOT_DESKTOP_CONFIG_JSON;
  if (!configurationBrute) {
    throw new Error("SERVER_FILE_RUNTIME_NOT_CONFIGURED");
  }
  const cleCache = `desktop:${configurationBrute}`;
  if (cache?.cacheKey === cleCache) return cache.store;

  let configuration: DesktopFileRuntimeConfig;
  try {
    configuration = JSON.parse(configurationBrute) as DesktopFileRuntimeConfig;
  } catch {
    throw new Error("DESKTOP_RUNTIME_CONFIG_INVALID");
  }

  if (
    typeof configuration.shared_data_path !== "string" ||
    !configuration.shared_data_path.trim()
  ) {
    throw new Error("DESKTOP_SHARED_PATH_REQUIRED");
  }

  const cheminRacine = path.resolve(configuration.shared_data_path);
  return cachedStore(cleCache, cheminRacine);
}
