import "server-only";

import type { CommercialCase } from "@/lib/commercial/domain";
import { commercialAffairFolderName, commercialDocumentFileName } from "@/lib/commercial/document-path";
import type { ServerFileStore } from "@/lib/server-files/storage";
import type { ChantierRecord } from "./domain";

export function chantierStorageFolder(
  chantier: Pick<ChantierRecord, "id" | "number" | "launchYear" | "clientName" | "name">,
): string {
  const reference = commercialDocumentFileName(chantier.number || chantier.id.slice(0, 8));
  return `Chantier/${chantier.launchYear}/${reference} - ${commercialAffairFolderName(chantier.clientName, chantier.name)}`;
}

export function commercialStorageFolder(
  affair: Pick<CommercialCase, "createdAt" | "clientName" | "name">,
): string {
  return `Commercial/${new Date(affair.createdAt).getFullYear()}/${commercialAffairFolderName(affair.clientName, affair.name)}`;
}

function currentCommercialDocumentFolder(storagePath: string): string | null {
  const segments = storagePath.split("/");
  if (segments[0] !== "Commercial") return null;
  if (segments.length < 5 || !/^\d{4}$/.test(segments[1])) {
    throw new Error("CHANTIER_SOURCE_DOCUMENT_PATH_INVALID");
  }
  return segments.slice(0, 3).join("/");
}

export type PreparedChantierFolder = {
  path: string;
  remap: (storagePath: string) => string;
  rollback: () => Promise<void>;
};

/**
 * Moves the *same* business folder rather than copying its documents.
 * Other files manually added to that folder travel with it.
 * File references are updated by the caller inside the DB transaction.
 */
export async function prepareChantierFolder(
  store: ServerFileStore,
  affair: CommercialCase,
  chantier: ChantierRecord,
  allAffairs: CommercialCase[],
): Promise<PreparedChantierFolder> {
  await store.assertReady();
  const target = chantierStorageFolder(chantier);
  const currentRoots = [...new Set(
    affair.documents
      .map((document) => currentCommercialDocumentFolder(document.storagePath))
      .filter((value): value is string => value !== null),
  )];
  if (currentRoots.length > 1) throw new Error("CHANTIER_SOURCE_MULTIPLE_FOLDERS");
  const source = currentRoots[0] ?? commercialStorageFolder(affair);

  if (allAffairs.some((other) =>
    other.id !== affair.id &&
    other.documents.some((document) => document.storagePath.startsWith(`${source}/`))
  )) {
    throw new Error("CHANTIER_SOURCE_FOLDER_SHARED");
  }

  const sourceExists = await store.directoryExists(source);
  const targetExists = await store.directoryExists(target);

  if (sourceExists && targetExists) throw new Error("CHANTIER_DESTINATION_FOLDER_EXISTS");

  if (sourceExists) {
    await store.moveDirectory(source, target);
  } else if (!targetExists) {
    if (currentRoots.length > 0) throw new Error("CHANTIER_SOURCE_FOLDER_MISSING");
    await store.ensureDirectory(target);
  } else if (currentRoots.length > 0) {
    // Recover an interrupted launch where the folder moved but the database rolled back.
    for (const document of affair.documents) {
      if (!document.storagePath.startsWith(`${source}/`)) continue;
      const newPath = `${target}/${document.storagePath.slice(source.length + 1)}`;
      await store.readBytes(newPath, document.sha256);
    }
  }

  return {
    path: target,
    remap: (storagePath: string) =>
      storagePath.startsWith(`${source}/`)
        ? `${target}/${storagePath.slice(source.length + 1)}`
        : storagePath,
    rollback: async () => {
      if (sourceExists) await store.moveDirectory(target, source);
    },
  };
}
