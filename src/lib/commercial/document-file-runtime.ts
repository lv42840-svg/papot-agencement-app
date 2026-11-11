import "server-only";

import { getServerFileStore } from "@/lib/server-files/runtime";
import type { CommercialDocumentTransport } from "./document-storage";

export async function createCommercialDocumentTransport(
  contexte: { displayName: string },
): Promise<CommercialDocumentTransport> {
  const stockage = getServerFileStore();
  await stockage.assertReady();

  return {
    store: stockage,
    displayName: contexte.displayName,
  };
}
