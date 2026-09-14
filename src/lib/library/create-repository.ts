import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { createPostgresBackedLibraryRepository } from "./postgres-factory";
import type { LibraryRepository } from "./repository";

export function createLibraryRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): LibraryRepository {
  return createPostgresBackedLibraryRepository(context);
}
