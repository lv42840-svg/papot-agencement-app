import "server-only";

import type { CommercialCase } from "@/lib/commercial/domain";
import {
  commercialAffairFolderName,
  commercialDocumentFileName,
} from "@/lib/commercial/document-path";
import type { ServerFileStore } from "@/lib/server-files/storage";
import type { ChantierRecord } from "./domain";

import {
  DEFAULT_CHANTIER_FOLDER_PATHS,
  canonicalFolderPath,
  folderTemplatePaths,
} from "./folder-template";
import { loadChantierFolderTemplate } from "./folder-template-storage";

export const CHANTIER_STANDARD_FOLDERS = DEFAULT_CHANTIER_FOLDER_PATHS;

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
  if (segments[0] === "Commercial") {
    if (segments.length < 5 || !/^\d{4}$/.test(segments[1])) {
      throw new Error("CHANTIER_SOURCE_DOCUMENT_PATH_INVALID");
    }
    return segments.slice(0, 3).join("/");
  }
  if (segments[0] === "Chantier") {
    const archived = segments[2] === "Archive";
    if (segments.length < (archived ? 6 : 5) || !/^\d{4}$/.test(segments[1])) {
      throw new Error("CHANTIER_SOURCE_DOCUMENT_PATH_INVALID");
    }
    return segments.slice(0, archived ? 4 : 3).join("/");
  }
  return null;
}

export async function ensureChantierStructure(store: ServerFileStore, root: string) {
  const template = await loadChantierFolderTemplate(store);
  await store.ensureDirectory(root);
  for (const folder of folderTemplatePaths(template)) {
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
  additionalStoragePaths: string[] = [],
): Promise<PreparedChantierFolder> {
  await store.assertReady();
  const target = chantierStorageFolder(chantier);
  const currentRoots = [
    ...new Set(
      [...affair.documents.map((document) => document.storagePath), ...additionalStoragePaths]
        .map(documentFolder)
        .filter((folder): folder is string => folder !== null),
    ),
  ];
  if (currentRoots.length > 1) throw new Error("CHANTIER_SOURCE_MULTIPLE_FOLDERS");

  const commercialSource = commercialStorageFolder(affair);
  const activeTarget = chantierStorageFolder({ ...chantier, status: "ACTIVE" });
  const fallbackSource =
    chantier.status === "ARCHIVED" && (await store.directoryExists(activeTarget))
      ? activeTarget
      : commercialSource;
  const source = currentRoots[0] ?? fallbackSource;
  if (
    allAffairs.some(
      (other) =>
        other.id !== affair.id &&
        other.documents.some((document) => document.storagePath.startsWith(`${source}/`)),
    )
  ) {
    throw new Error("CHANTIER_SOURCE_FOLDER_SHARED");
  }

  const sourceExists = await store.directoryExists(source);
  const targetExists = await store.directoryExists(target);
  if (source !== target && sourceExists && targetExists)
    throw new Error("CHANTIER_DESTINATION_FOLDER_EXISTS");
  if (!sourceExists && !targetExists && currentRoots.length > 0) {
    throw new Error("CHANTIER_SOURCE_FOLDER_MISSING");
  }

  let movedRoot = false;
  const categoryMoves: Array<{ from: string; to: string }> = [];
  const template = await loadChantierFolderTemplate(store);
  const rollback = async () => {
    for (const move of [...categoryMoves].reverse()) {
      await store.moveDirectory(move.to, move.from);
    }
    if (movedRoot) await store.moveDirectory(target, source);
  };

  try {
    if (sourceExists && source !== target) {
      await store.moveDirectory(source, target);
      movedRoot = true;
    } else if (!targetExists) {
      await store.ensureDirectory(target);
    }

    // Legacy documents live directly under Commercial/<year>/<case>/Devis.
    // Reclassify whole directories, never copy documents or overwrite files.
    for (const category of LEGACY_COMMERCIAL_CATEGORIES) {
      const previous = `${target}/${category}`;
      const next = `${target}/${canonicalFolderPath(template, "Devis-Chiffrage/" + category)}`;
      if (previous === next || !(await store.directoryExists(previous))) continue;
      if (await store.directoryExists(next)) {
        throw new Error("CHANTIER_CATEGORY_DESTINATION_EXISTS");
      }
      await store.ensureDirectory(next.slice(0, next.lastIndexOf("/")));
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
          value = `${target}/${canonicalFolderPath(template, "Devis-Chiffrage/" + category)}/${value.slice(oldPrefix.length)}`;
          break;
        }
      }
      return value;
    };

    // When recovering a previous interrupted move, only accept paths
    // whose files really exist at their proposed new location.
    for (const document of affair.documents) {
      const next = remap(document.storagePath);
      if (next !== document.storagePath && !movedRoot) {
        await store.readBytes(next, document.sha256);
      }
    }
    if (!movedRoot) {
      for (const storagePath of additionalStoragePaths) {
        const next = remap(storagePath);
        if (next !== storagePath) await store.readBytes(next);
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
