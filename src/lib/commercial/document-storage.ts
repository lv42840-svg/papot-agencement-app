import "server-only";

import { randomUUID } from "node:crypto";
import type { ServerFileStore } from "@/lib/server-files/storage";
import {
  commercialDocumentCategorySchema,
  type CommercialDocument,
  type CommercialDocumentCategory,
} from "./domain";
import { commercialDocumentStoragePath } from "./document-path";

export const MAX_COMMERCIAL_DOCUMENTS_PER_UPLOAD = 12;
export const MAX_COMMERCIAL_DOCUMENT_BYTES = 100 * 1024 * 1024;

export type CommercialDocumentTransport = {
  store: ServerFileStore;
  displayName: string;
};

export type CommercialDocumentUploadOptions = {
  category: CommercialDocumentCategory;
  versionLabel?: string | null;
  variantLabel?: string | null;
  isCurrent?: boolean;
  isSignedQuote?: boolean;
};

function validateFiles(fichiers: File[]): void {
  if (fichiers.length === 0) {
    throw new Error("COMMERCIAL_DOCUMENTS_REQUIRED");
  }
  if (fichiers.length > MAX_COMMERCIAL_DOCUMENTS_PER_UPLOAD) {
    throw new Error("COMMERCIAL_DOCUMENTS_TOO_MANY");
  }
  for (const fichier of fichiers) {
    if (!fichier.name.trim()) {
      throw new Error("COMMERCIAL_DOCUMENT_NAME_REQUIRED");
    }
    if (fichier.size > MAX_COMMERCIAL_DOCUMENT_BYTES) {
      throw new Error("COMMERCIAL_DOCUMENT_TOO_LARGE");
    }
  }
}

function validateDocumentPath(document: CommercialDocument): string[] {
  const cheminCourant = document.storagePath.startsWith("Commercial/");
  const cheminHistorique = document.storagePath.startsWith("documents/commercial/");
  if (!cheminCourant && !cheminHistorique) {
    throw new Error("COMMERCIAL_DOCUMENT_PATH_INVALID");
  }
  const segments = document.storagePath.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("COMMERCIAL_DOCUMENT_PATH_INVALID");
  }
  return segments;
}

export async function uploadCommercialDocuments(
  transport: CommercialDocumentTransport,
  parametres: {
    creationYear: number;
    clientName: string | null;
    caseName: string;
    files: File[];
    options: CommercialDocumentUploadOptions;
    now?: Date;
  },
): Promise<CommercialDocument[]> {
  validateFiles(parametres.files);
  const categorie = commercialDocumentCategorySchema.parse(parametres.options.category);
  const maintenant = parametres.now ?? new Date();
  const documentsEnvoyes: CommercialDocument[] = [];

  if (parametres.options.isSignedQuote && categorie !== "QUOTE") {
    throw new Error("COMMERCIAL_SIGNED_QUOTE_CATEGORY_INVALID");
  }

  try {
    for (const fichier of parametres.files) {
      const id = randomUUID();
      const cheminStockage = commercialDocumentStoragePath({
        creationYear: parametres.creationYear,
        clientName: parametres.clientName,
        caseName: parametres.caseName,
        category: categorie,
        fileName: fichier.name,
      });
      const octets = Buffer.from(await fichier.arrayBuffer());
      const ecriture = await transport.store.writeBytes(cheminStockage, octets);

      documentsEnvoyes.push({
        id,
        fileName: fichier.name,
        contentType: fichier.type || "application/octet-stream",
        sizeBytes: ecriture.sizeBytes,
        sha256: ecriture.sha256,
        storagePath: ecriture.storagePath,
        category: categorie,
        versionLabel: parametres.options.versionLabel?.trim() || null,
        variantLabel: parametres.options.variantLabel?.trim() || null,
        isCurrent: parametres.options.isCurrent ?? true,
        isSignedQuote: parametres.options.isSignedQuote ?? false,
        uploadedAt: maintenant.toISOString(),
        uploadedByName: transport.displayName,
      });
    }

    return documentsEnvoyes;
  } catch (erreur) {
    await cleanupCommercialDocuments(transport, documentsEnvoyes);
    throw erreur;
  }
}

export async function readCommercialDocument(
  transport: Pick<CommercialDocumentTransport, "store">,
  document: CommercialDocument,
): Promise<Buffer> {
  validateDocumentPath(document);
  const octets = await transport.store.readBytes(document.storagePath, document.sha256);
  if (octets.length !== document.sizeBytes) {
    throw new Error("COMMERCIAL_DOCUMENT_INTEGRITY_MISMATCH");
  }
  return octets;
}

export async function cleanupCommercialDocuments(
  transport: Pick<CommercialDocumentTransport, "store">,
  documents: CommercialDocument[],
): Promise<void> {
  await Promise.all(
    documents.map((document) =>
      transport.store.deleteFile(document.storagePath).catch(() => undefined),
    ),
  );
}
