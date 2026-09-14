import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { createNextcloudClientsRepository } from "./nextcloud-repository";
import type { ClientsRepository } from "./repository";

export function createClientsRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): ClientsRepository {
  return createNextcloudClientsRepository({
    states: context.desktop.states,
    locks: context.desktop.locks,
    owner: context.owner,
  });
}
