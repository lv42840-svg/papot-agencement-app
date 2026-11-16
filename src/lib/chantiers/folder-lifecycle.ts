import "server-only";

import type { CommercialCase } from "@/lib/commercial/domain";
import { commercialAffairFolderName, commercialDocumentFileName } from "@/lib/commercial/document-path";
import type { ServerFileStore } from "@/lib/server-files/storage";
import type { ChantierRecord } from "./domain";

// "BE / Atelier" and "Documents architecte / MOE" are interface labels.
// The slash cannot be part of a physical Windows-compatible folder name.
export const CHANTIER_STANDARD_FOLDERS = [
  "Administratif",
  "Devis-Chiffrage",
  "Devis-Chiffrage/Documents reçus",
  "Devis-Chiffrage/Chiffrage interne",
  "Devis-Chiffrage/Devis",
  "Devis-Chiffrage/Déboursé",
  "Devis-Chiffrage/Divers",
  "Documents chantier",
  "Documents chantier/Plans",
  "Documents chantier/Plannings",
  "Documents chantier/Documents architecte - MOE",
  "Documents chantier/Divers",
  "BE - Atelier",
  "BE - Atelier/TOP",
  "BE - Atelier/DFT",
  "BE - Atelier/DXF",
  "BE - Atelier/Débit",
  "BE - Atelier/Documents divers",
  "BE - Atelier/Programme CN",
  "Atelier",
  "Pose",
  "Réunions",
  "Mails",
  "Réception",
  "SAV",
] as const;

const LEGACY_COMMERCIAL_CATEGORIES = [
  "Documents reçus",
  "Chiffrage interne",
  "Devis",
  "Déboursé",
  "Divers",
] as const;

export function chantierStorageFolder(
  chantier: Pick<ChantierRecord, "id" | "number" | "launchYear" | "clientName" | "name" | "status">,
): string {
  const reference = commercialDocumentFileName(chantier.number || chantier.id.slice(0, 8));
  const year = `Chantier/${chantier.launchYear}`;
  const parent = chantier.status === "ARCHIVED" ? `${year}/Archive` : year;
  return `${parent}/${reference} - ${commercialAffairFolderName(chantier.clientName, chantier.name)}`;
}

export function commercialStorageFolder(
  affair: Pick<CommercialCase, "createdAt" | "clientName" | "name">,
): string {
  return `Commercial/${new Date(affair.createdAt).getFullYear()}/${commercialAffairFolderName(affair.clientName, affair.name)}`;
}

function documentFolder(storagePath: string): string | null {
  const segments = storagePath.split("/");
  if (segments[0] !== "Commercial") return null;
  if (segments.length < 5 || !/^\d{4}$/.test(segments[1])) {
    throw new Error("CHANTIER_SOURCE_DOCUMENT_PATH_INVALID");
  }
  return segments.slice(0, 3).join("/");
}

export async function ensureChantierStructure(store: ServerFileStore, root: string) {
  await store.ensureDirectory(root);
  for (const folder of CHANTIER_STANDARD_FOLDERS) {
    await store.ensureDirectory(`${root}/${folder}`);
  }
}

export type PreparedChantierFolder = {
  path: string;
  remap: (storagePath: string) => string;
  rollback: () => Promise<void>;
};

/** One physical dossier survives from Commercial into Chantier.
 * The data-store transaction that changes references belongs to the caller.
 */
export async function prepareChantierFolder(
  store: ServerFileStore,
  affair: CommercialCase,
  chantier: ChantierRecord,
  allAffairs: CommercialCase[],
): Promise<PreparedChantierFolder> {
  await store.assertReady();
  const target = chantierStorageFolder(chantier);
  const currentRoots = [...new Set(affair.documents
    .map((document) => documentFolder(document.storagePath))
    .filter((folder): folder is string => folder !== null))];
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
  if (!sourceExists && !targetExists && currentRoots.length > 0) {
    throw new Error("CHANTIER_SOURCE_FOLDER_MISSING");
  }

  let movedRoot = false;
  const categoryMoves: Array<{ from: string; to: string }> = [];
  const rollback = async () => {
    for (const move of [...categoryMoves].reverse()) {
      await store.moveDirectory(move.to, move.from);
    }
    if (movedRoot) await store.moveDirectory(target, source);
  };

  try {
    if (sourceExists) {
      await store.moveDirectory(source, target);
      movedRoot = true;
    } else if (!targetExists) {
      await store.ensureDirectory(target);
    }

    // Legacy documents live directly under Commercial/<year>/<case>/Devis.
    // Reclassify whole directories, never copy documents or overwrite files.
    for (const category of LEGACY_COMMERCIAL_CATEGORIES) {
      const previous = `${target}/${category}`;
      const next = `${target}/Devis-Chiffrage/${category}`;
      if (!(await store.directoryExists(previous))) continue;
      if (await store.directoryExists(next)) {
        throw new Error("CHANTIER_CATEGORY_DESTINATION_EXISTS");
      }
      await store.ensureDirectory(`${target}/Devis-Chiffrage`);
      await store.moveDirectory(previous, next);
      categoryMoves.push({ from: previous, to: next });
    }

    await ensureChantierStructure(store, target);
    const remap = (storagePath: string) => {
      let value = storagePath.startsWith(`${source}/`)
        ? `${target}/${storagePath.slice(source.length + 1)}`
        : storagePath;
      for (const category of LEGACY_COMMERCIAL_CATEGORIES) {
        const oldPrefix = `${target}/${category}/`;
        if (value.startsWith(oldPrefix)) {
          value = `${target}/Devis-Chiffrage/${category}/${value.slice(oldPrefix.length)}`;
          break;
        }
      }
      return value;
    };

    // When recovering a previous interrupted move, only accept paths
    // whose files really exist at their proposed new location.
    for (const document of affair.documents) {
      const next = remap(document.storagePath);
      if (next !== document.storagePath && !sourceExists) {
        await store.readBytes(next, document.sha256);
      }
    }
    return { path: target, remap, rollback };
  } catch (error) {
    await rollback().catch((rollbackError) => {
      console.error("[PAPOT] rollback interrupted during folder preparation", rollbackError);
    });
    throw error;
  }
}
