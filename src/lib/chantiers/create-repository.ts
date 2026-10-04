import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { createLocalChantiersRepository } from "./local-repository";
import { createPostgresBackedChantiersRepository } from "./postgres-factory";
import type { ChantiersRepository } from "./repository";

export function createChantiersRepository(_context?: unknown): ChantiersRepository {
  if (isLocalStorageMode()) return createLocalChantiersRepository();
  return createPostgresBackedChantiersRepository();
}
