import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { createNextcloudLibraryRepository } from "./nextcloud-repository";
import { createPostgresBackedLibraryRepository } from "./postgres-factory";
import type { LibraryRepository } from "./repository";

export function createLibraryRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): LibraryRepository {
  if (isLocalStorageMode()) {
    return createNextcloudLibraryRepository(context);
  }
  return createPostgresBackedLibraryRepository(context);
}
