import "server-only";

import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { getServerFileStore } from "@/lib/server-files/runtime";
import { ensureCommercialDocumentFilesCutover } from "./document-file-cutover";
import {
  readLegacyCommercialDocumentBytes,
  type CommercialDocumentTransport,
} from "./document-storage";

type LegacyCommercialDocumentContext = Pick<DesktopRequestContext, "desktop" | "owner">;
type WebCommercialDocumentContext = { displayName: string };

export async function createCommercialDocumentTransport(
  context: LegacyCommercialDocumentContext | WebCommercialDocumentContext,
): Promise<CommercialDocumentTransport> {
  const store = getServerFileStore();
  await store.assertReady();

  const displayName = "owner" in context ? context.owner.displayName : context.displayName;

  if (isLocalStorageMode()) {
    return {
      store,
      displayName,
    };
  }

  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  await ensureCommercialDocumentFilesCutover({
    pool,
    store,
    readLegacy:
      "desktop" in context
        ? (document) =>
            readLegacyCommercialDocumentBytes(
              {
                dav: context.desktop.dav,
                nextcloudUserId: context.desktop.nextcloudUserId,
                syncRoot: context.desktop.syncRoot,
              },
              document,
            )
        : undefined,
  });

  return {
    store,
    displayName,
  };
}
