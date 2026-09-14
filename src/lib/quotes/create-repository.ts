import "server-only";

import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { createLocalQuotesRepository } from "./local-repository";
import type { QuotesRepository } from "./repository";

export function createQuotesRepository(): QuotesRepository {
  if (isLocalStorageMode()) return createLocalQuotesRepository();
  throw new Error("QUOTES_SERVER_REPOSITORY_NOT_IMPLEMENTED");
}
