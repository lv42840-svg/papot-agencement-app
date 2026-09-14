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

export async function createCommercialDocumentTransport(
  context: Pick<DesktopRequestContext, "desktop" | "owner">,
): Promise<CommercialDocumentTransport> {
  const store = getServerFileStore();
  await store.assertReady();

  if (isLocalStorageMode()) {
    return {
      store,
      displayName: context.owner.displayName,
    };
  }

  const pool = getServerDbPool();
  await runServerDbMigrations(pool);
  await ensureCommercialDocumentFilesCutover({
    pool,
    store,
    readLegacy: (document) =>
      readLegacyCommercialDocumentBytes(
        {
          dav: context.desktop.dav,
          nextcloudUserId: context.desktop.nextcloudUserId,
          syncRoot: context.desktop.syncRoot,
        },
        document,
      ),
  });

  return {
    store,
    displayName: context.owner.displayName,
  };
}
