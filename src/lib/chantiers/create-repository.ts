import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { createPostgresBackedChantiersRepository } from "./postgres-factory";
import type { ChantiersRepository } from "./repository";

export function createChantiersRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): ChantiersRepository {
  return createPostgresBackedChantiersRepository(context);
}
