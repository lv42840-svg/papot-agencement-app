import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { createNextcloudChantiersRepository } from "./nextcloud-repository";
import type { ChantiersRepository } from "./repository";

export function createChantiersRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): ChantiersRepository {
  return createNextcloudChantiersRepository({
    desktop: context.desktop,
    owner: context.owner,
  });
}
