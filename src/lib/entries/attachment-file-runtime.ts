import "server-only";

import { getServerFileStore } from "@/lib/server-files/runtime";
import type { EntryAttachmentTransport } from "./attachment-storage";

type EntryAttachmentRuntimeContext = {
  owner: {
    displayName: string;
  };
};

export async function createEntryAttachmentTransport(
  context: EntryAttachmentRuntimeContext,
): Promise<EntryAttachmentTransport> {
  const store = getServerFileStore();
  await store.assertReady();

  return {
    store,
    displayName: context.owner.displayName,
  };
}
