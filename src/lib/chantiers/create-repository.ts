import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { createLocalChantiersRepository } from "./local-repository";
import { createPostgresBackedChantiersRepository } from "./postgres-factory";
import type { ChantiersRepository } from "./repository";

export function createChantiersRepository(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): ChantiersRepository {
  if (isLocalStorageMode()) return createLocalChantiersRepository();
  return createPostgresBackedChantiersRepository(context);
}
