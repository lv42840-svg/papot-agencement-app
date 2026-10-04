import "server-only";

import { getServerFileStore } from "@/lib/server-files/runtime";
import type { CommercialDocumentTransport } from "./document-storage";

export async function createCommercialDocumentTransport(context: {
  displayName: string;
}): Promise<CommercialDocumentTransport> {
  const store = getServerFileStore();
  await store.assertReady();

  return {
    store,
    displayName: context.displayName,
  };
}
