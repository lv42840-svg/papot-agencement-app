import "server-only";

import { getServerFileStore } from "@/lib/server-files/runtime";
import type { EntryAttachmentTransport } from "./attachment-storage";

type EntryAttachmentRuntimeContext = {
  owner: {
    displayName: string;
  };
};

export async function createEntryAttachmentTransport(
  contexte: EntryAttachmentRuntimeContext,
): Promise<EntryAttachmentTransport> {
  const stockage = getServerFileStore();
  await stockage.assertReady();

  return {
    store: stockage,
    displayName: contexte.owner.displayName,
  };
}
