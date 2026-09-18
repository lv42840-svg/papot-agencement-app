import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { createSharedResourceLibraryRepository } from "./shared-resource-repository";
import { createPostgresBackedLibraryRepository } from "./postgres-factory";
import type { LibraryRepository } from "./repository";

export function createLibraryRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): LibraryRepository {
  if (isLocalStorageMode()) {
    return createSharedResourceLibraryRepository(context);
  }
  return createPostgresBackedLibraryRepository(context);
}
