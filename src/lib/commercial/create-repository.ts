import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { createNextcloudCommercialRepository } from "./nextcloud-repository";
import type { CommercialRepository } from "./repository";

export function createCommercialRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): CommercialRepository {
  return createNextcloudCommercialRepository({
    desktop: context.desktop,
    owner: context.owner,
  });
}
