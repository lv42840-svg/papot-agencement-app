import "server-only";

import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import type { NativeQuoteRecord } from "@/lib/quotes/store";
import { withBusinessTransaction } from "@/lib/server-db/business-transaction";
import { getServerFileStore } from "@/lib/server-files/runtime";
import {
  chantierStorageFolder,
  commercialStorageFolder,
  ensureChantierStructure,
  prepareChantierFolder,
  type PreparedChantierFolder,
} from "./folder-lifecycle";
import type { ChantierRecord } from "./domain";
import { folderTemplatePaths } from "./folder-template";
import { loadChantierFolderTemplate } from "./folder-template-storage";

export type ChantierFolderAudit = {
  chantierId: string;
  number: string | null;
  name: string;
  status: ChantierRecord["status"];
  folder: string;
  action: "ALREADY_PRESENT" | "CREATE" | "MOVE" | "COMPLETE" | "CONFLICT";
  commercialLinked: boolean;
  quoteCount: number;
  retainedQuoteCount: number;
  beItemCount: number;
  warning: string | null;
};

function quotePaths(affairId: string, quotes: NativeQuoteRecord[]): string[] {
  return quotes
    .filter((quote) => quote.commercialCaseId === affairId && quote.finalPdf)
    .map((quote) => quote.finalPdf!.storagePath);
}

export async function auditChantierFolders(): Promise<ChantierFolderAudit[]> {
  const store = getServerFileStore();
  await store.assertReady();
  const [chantiers, commercial, quotes] = await Promise.all([
    createChantiersRepository().load(),
    createCommercialRepository().load(),
    createQuotesRepository().load(),
  ]);

  const template = await loadChantierFolderTemplate(store);
  const expectedFolders = folderTemplatePaths(template);
  const result: ChantierFolderAudit[] = [];
  for (const chantier of chantiers.chantiers) {
    const affair = commercial.cases.find((item) => item.id === chantier.sourceCommercialCaseId);
    const relatedQuotes = quotes.quotes.filter(
      (quote) => quote.commercialCaseId === chantier.sourceCommercialCaseId,
    );
    const folder = chantierStorageFolder(chantier);
    const targetExists = await store.directoryExists(folder);
    const candidateSource = affair
      ? affair.documents.find((document) => document.storagePath.startsWith("Commercial/"))
          ?.storagePath
      : undefined;
    const rootFromDocument = candidateSource
      ? candidateSource.split("/").slice(0, 3).join("/")
      : null;
    const commercialRoot = affair ? (rootFromDocument ?? commercialStorageFolder(affair)) : null;
    const sourceExists = commercialRoot ? await store.directoryExists(commercialRoot) : false;
    const activeFolder = chantierStorageFolder({ ...chantier, status: "ACTIVE" });
    const archivedSourceExists =
      chantier.status === "ARCHIVED" &&
      activeFolder !== folder &&
      (await store.directoryExists(activeFolder));
    const needsRelinking =
      Boolean(
        affair?.documents.some((document) => document.storagePath.startsWith("Commercial/")),
      ) || relatedQuotes.some((quote) => quote.finalPdf?.storagePath.startsWith("Commercial/"));
    const keyFoldersComplete =
      targetExists &&
      (
        await Promise.all(
          expectedFolders.map((subfolder) => store.directoryExists(`${folder}/${subfolder}`)),
        )
      ).every(Boolean);
    let action: ChantierFolderAudit["action"] = "CREATE";
    if (targetExists && (sourceExists || archivedSourceExists)) action = "CONFLICT";
    else if (sourceExists || archivedSourceExists) action = "MOVE";
    else if (targetExists)
      action = keyFoldersComplete && !needsRelinking ? "ALREADY_PRESENT" : "COMPLETE";
    // Folder is not created until a repair is explicitly confirmed.
    const warning = !affair
      ? "Affaire commerciale d'origine absente : vérifier manuellement les devis et documents."
      : action === "CONFLICT"
        ? "Deux dossiers physiques existent : rapprochement manuel nécessaire avant toute opération."
        : affair.documents.some((document) => document.storagePath.startsWith("Commercial/")) &&
            !sourceExists &&
            !targetExists
          ? "Documents référencés, mais dossier source introuvable."
          : null;
    if (warning && action !== "CONFLICT" && affair) action = "CONFLICT";
    result.push({
      chantierId: chantier.id,
      number: chantier.number,
      name: chantier.name,
      status: chantier.status,
      folder,
      action,
      commercialLinked: Boolean(affair),
      quoteCount: relatedQuotes.length,
      retainedQuoteCount: affair?.retainedQuoteIds.length ?? 0,
      beItemCount: chantier.operational.beItems.length,
      warning,
    });
  }
  return result;
}

export async function repairChantierFolder(chantierId: string): Promise<{
  chantierId: string;
  folder: string;
  filesRelinked: number;
  quotePdfsRelinked: number;
  relatedQuotes: number;
  beItems: number;
  warning: string | null;
}> {
  const store = getServerFileStore();
  await store.assertReady();
  const state: { prepared: PreparedChantierFolder | null; committed: boolean } = {
    prepared: null,
    committed: false,
  };
  try {
    const result = await withBusinessTransaction(async () => {
      const chantiersRepository = createChantiersRepository();
      const commercialRepository = createCommercialRepository();
      const quotesRepository = createQuotesRepository();
      const [chantiers, commercial, quotes] = await Promise.all([
        chantiersRepository.load(),
        commercialRepository.load(),
        quotesRepository.load(),
      ]);
      const chantier = chantiers.chantiers.find((item) => item.id === chantierId);
      if (!chantier) throw new Error("CHANTIER_NOT_FOUND");
      const affair = commercial.cases.find((item) => item.id === chantier.sourceCommercialCaseId);
      const relatedQuotes = quotes.quotes.filter(
        (quote) => quote.commercialCaseId === chantier.sourceCommercialCaseId,
      );
      const folder = chantierStorageFolder(chantier);
      let filesRelinked = 0;
      let quotePdfsRelinked = 0;

      if (affair) {
        state.prepared = await prepareChantierFolder(
          store,
          affair,
          chantier,
          commercial.cases,
          quotePaths(affair.id, relatedQuotes),
        );
        const prepared = state.prepared;

        // Check that each referenced document remains readable before committing new links.
        for (const document of affair.documents) {
          const updatedPath = prepared.remap(document.storagePath);
          if (updatedPath !== document.storagePath) {
            await store.readBytes(updatedPath, document.sha256);
            filesRelinked += 1;
          }
        }
        for (const quote of relatedQuotes) {
          if (!quote.finalPdf) continue;
          const updatedPath = prepared.remap(quote.finalPdf.storagePath);
          if (updatedPath !== quote.finalPdf.storagePath) {
            await store.readBytes(updatedPath, quote.finalPdf.sha256);
            quotePdfsRelinked += 1;
          }
        }

        if (filesRelinked > 0) {
          await commercialRepository.mutate((payload) => {
            const current = payload.cases.find((item) => item.id === affair.id);
            if (!current) throw new Error("CHANTIER_COMMERCIAL_CASE_NOT_FOUND");
            current.documents = current.documents.map((document) => ({
              ...document,
              storagePath: prepared.remap(document.storagePath),
            }));
            return { payload, focusCaseId: current.id };
          });
        }
        if (quotePdfsRelinked > 0) {
          const focusQuoteId = relatedQuotes.find(
            (quote) =>
              quote.finalPdf &&
              prepared.remap(quote.finalPdf.storagePath) !== quote.finalPdf.storagePath,
          )?.id;
          if (!focusQuoteId) throw new Error("CHANTIER_QUOTE_RELINK_CONFLICT");
          await quotesRepository.mutate((payload) => {
            for (const quote of payload.quotes) {
              if (quote.commercialCaseId === affair.id && quote.finalPdf) {
                quote.finalPdf.storagePath = prepared.remap(quote.finalPdf.storagePath);
              }
            }
            return { payload, focusQuoteId };
          });
        }
      } else {
        // Preserve the chantier even if its commercial source has since been removed.
        // Never invent missing quotes or other historical records.
        await ensureChantierStructure(store, folder);
      }
      return {
        chantierId,
        folder,
        filesRelinked,
        quotePdfsRelinked,
        relatedQuotes: relatedQuotes.length,
        beItems: chantier.operational.beItems.length,
        warning: affair
          ? null
          : "Affaire commerciale absente : liens devis à vérifier manuellement.",
      };
    });
    state.committed = true;
    return result;
  } catch (error) {
    if (!state.committed && state.prepared) {
      try {
        await state.prepared.rollback();
      } catch (rollbackError) {
        console.error("[PAPOT] chantier backfill rollback failed", { chantierId, rollbackError });
      }
    }
    throw error;
  }
}
