import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { createLocalClientsRepository } from "./local-repository";
import { createPostgresClientsRepository } from "./postgres-repository";
import type { ClientsRepository } from "./repository";

export async function createClientsRepository(): Promise<ClientsRepository> {
  if (isLocalStorageMode()) return createLocalClientsRepository();

  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  return createPostgresClientsRepository(pool);
}
