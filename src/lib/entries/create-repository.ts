import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { createLocalEntriesRepository } from "./local-repository";
import { createPostgresEntriesRepository } from "./postgres-repository";
import type { EntriesRepository } from "./repository";

export async function createEntriesRepository(): Promise<EntriesRepository> {
  if (isLocalStorageMode()) return createLocalEntriesRepository();

  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  return createPostgresEntriesRepository(pool);
}
