import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { createNextcloudLibraryRepository } from "./nextcloud-repository";
import type { LibraryRepository } from "./repository";

export function createLibraryRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): LibraryRepository {
  return createNextcloudLibraryRepository({
    desktop: context.desktop,
    owner: context.owner,
  });
}
