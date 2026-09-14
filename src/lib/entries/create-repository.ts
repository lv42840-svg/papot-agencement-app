import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { createNextcloudEntriesRepository } from "./nextcloud-repository";
import type { EntriesRepository } from "./repository";

export function createEntriesRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): EntriesRepository {
  return createNextcloudEntriesRepository({
    desktop: context.desktop,
    owner: context.owner,
  });
}
