import type { DesktopRequestContext, ModuleRequestContext } from "@/lib/desktop/request-context";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { createLocalChantiersRepository } from "./local-repository";
import { createPostgresBackedChantiersRepository } from "./postgres-factory";
import type { ChantiersRepository } from "./repository";

type ChantiersContext = Pick<DesktopRequestContext, "desktop" | "owner"> | ModuleRequestContext;

export function createChantiersRepository(context: ChantiersContext): ChantiersRepository {
  if (isLocalStorageMode()) {
    if (!("desktop" in context)) throw new Error("DESKTOP_RUNTIME_NOT_CONFIGURED");
    return createLocalChantiersRepository();
  }
  return createPostgresBackedChantiersRepository(context);
}
