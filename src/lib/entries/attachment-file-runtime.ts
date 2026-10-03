import "server-only";

import type { DesktopRequestContext } from "@/lib/desktop/request-context";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { getServerDbPool, runServerDbMigrations } from "@/lib/server-db";
import { getServerFileStore } from "@/lib/server-files/runtime";
import { ensureEntryAttachmentFilesCutover } from "./attachment-file-cutover";
import {
  readLegacyEntryAttachmentBytes,
  type EntryAttachmentTransport,
} from "./attachment-storage";

type EntryAttachmentRuntimeContext = {
  owner: {
    displayName: string;
  };
  desktop?: DesktopRequestContext["desktop"];
};

export async function createEntryAttachmentTransport(
  context: EntryAttachmentRuntimeContext,
): Promise<EntryAttachmentTransport> {
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
  await ensureEntryAttachmentFilesCutover({
    pool,
    store,
    readLegacy: (attachment) => {
      if (!context.desktop) {
        throw new Error("ENTRY_ATTACHMENT_LEGACY_CUTOVER_CONTEXT_REQUIRED");
      }
      return readLegacyEntryAttachmentBytes(
        {
          dav: context.desktop.dav,
          nextcloudUserId: context.desktop.nextcloudUserId,
          syncRoot: context.desktop.syncRoot,
        },
        attachment,
      );
    },
  });

  return {
    store,
    displayName: context.owner.displayName,
  };
}
