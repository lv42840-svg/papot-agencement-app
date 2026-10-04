import type {
  DesktopRequestContext,
  ModuleRequestContext,
} from "@/lib/desktop/request-context";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { createSharedResourceLibraryRepository } from "./shared-resource-repository";
import { createPostgresBackedLibraryRepository } from "./postgres-factory";
import type { LibraryRepository } from "./repository";

type LibraryContext =
  | Pick<DesktopRequestContext, "desktop" | "owner">
  | ModuleRequestContext;

export function createLibraryRepository(context: LibraryContext): LibraryRepository {
  if (isLocalStorageMode()) {
    if (!("desktop" in context)) throw new Error("DESKTOP_RUNTIME_NOT_CONFIGURED");
    return createSharedResourceLibraryRepository(context);
  }
  return createPostgresBackedLibraryRepository(context);
}
