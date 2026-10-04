import type { ModuleRequestContext } from "@/lib/desktop/request-context";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { createPostgresBackedLibraryRepository } from "./postgres-factory";
import type { LibraryRepository } from "./repository";

export function createLibraryRepository(context: ModuleRequestContext): LibraryRepository {
  if (isLocalStorageMode()) {
    throw new Error("LOCAL_LIBRARY_UNSUPPORTED");
  }
  return createPostgresBackedLibraryRepository(context);
}
