import { randomUUID } from "node:crypto";
import type { CommercialDocument } from "../commercial/domain";
import {
  commercialDocumentFileName,
  commercialDocumentStoragePath,
} from "../commercial/document-path";
import { assertPdfBuffer } from "../documents/pdf-runtime";
import { sha256Bytes, type ServerFileStore } from "../server-files/storage";
import { formatQuoteNumber } from "./domain";
import type { NativeQuoteRecord, NativeQuotesPayload, QuoteFinalPdf } from "./store";

const FINAL_QUOTE_NUMBER_PATTERN = /^D-(\d{4})-(\d{4})$/;

export type QuoteFinalPdfArchiveContext = {
  creationYear: number;
  clientName: string | null;
  caseName: string;
};

export type QuoteFinalPdfArchiveResult = {
  finalPdf: QuoteFinalPdf;
  commercialDocument: CommercialDocument;
  created: boolean;
};

function existingSequence(quoteNumber: string, annee: number): number | null {
  const correspondance = quoteNumber.match(FINAL_QUOTE_NUMBER_PATTERN);
  if (!correspondance || Number(correspondance[1]) !== annee) return null;
  return Number(correspondance[2]);
}

export function nextFinalQuoteNumber(contenu: NativeQuotesPayload, annee: number): string {
  const highest = contenu.quotes.reduce((courant, quote) => {
    const sequence = quote.finalPdf ? existingSequence(quote.finalPdf.quoteNumber, annee) : null;
    return sequence === null ? courant : Math.max(courant, sequence);
  }, 0);
  return formatQuoteNumber(annee, highest + 1);
}

export function quoteFinalPdfFileName(
  quote: Pick<NativeQuoteRecord, "variantName" | "version">,
  quoteNumber: string,
): string {
  return commercialDocumentFileName(
    `Devis ${quoteNumber} - ${quote.variantName} - V${quote.version}.pdf`,
  );
}

export function quoteFinalPdfStoragePath(
  contexte: QuoteFinalPdfArchiveContext,
  quote: Pick<NativeQuoteRecord, "variantName" | "version">,
  quoteNumber: string,
): string {
  return commercialDocumentStoragePath({
    creationYear: contexte.creationYear,
    clientName: contexte.clientName,
    caseName: contexte.caseName,
    category: "QUOTE",
    fileName: quoteFinalPdfFileName(quote, quoteNumber),
  });
}

function isExistingFileError(erreur: unknown): boolean {
  return erreur instanceof Error && erreur.message === "SERVER_FILE_EXISTS";
}

export async function archiveFinalQuotePdf(
  store: ServerFileStore,
  saisie: {
    quote: Pick<NativeQuoteRecord, "variantName" | "version">;
    quoteNumber: string;
    context: QuoteFinalPdfArchiveContext;
    pdf: Uint8Array;
    actorName: string;
    now?: Date;
  },
): Promise<QuoteFinalPdfArchiveResult> {
  assertPdfBuffer(saisie.pdf);
  const maintenant = saisie.now ?? new Date();
  const fileName = quoteFinalPdfFileName(saisie.quote, saisie.quoteNumber);
  const storagePath = quoteFinalPdfStoragePath(saisie.context, saisie.quote, saisie.quoteNumber);
  const expectedSha256 = sha256Bytes(saisie.pdf);
  let created = true;
  let sizeBytes = saisie.pdf.byteLength;
  let sha256 = expectedSha256;

  try {
    const written = await store.writeBytes(storagePath, saisie.pdf);
    sizeBytes = written.sizeBytes;
    sha256 = written.sha256;
  } catch (erreur) {
    if (!isExistingFileError(erreur)) throw erreur;
    const existing = await store.readBytes(storagePath);
    if (existing.byteLength !== saisie.pdf.byteLength || sha256Bytes(existing) !== expectedSha256) {
      throw new Error("QUOTE_FINAL_PDF_ARCHIVE_CONFLICT");
    }
    assertPdfBuffer(existing);
    created = false;
    sizeBytes = existing.byteLength;
    sha256 = expectedSha256;
  }

  const commercialDocumentId = randomUUID();
  const archivedAt = maintenant.toISOString();
  const finalPdf: QuoteFinalPdf = {
    quoteNumber: saisie.quoteNumber,
    variantName: saisie.quote.variantName,
    version: saisie.quote.version,
    commercialDocumentId,
    fileName,
    storagePath,
    sizeBytes,
    sha256,
    archivedAt,
    archivedByName: saisie.actorName,
  };
  const commercialDocument: CommercialDocument = {
    id: commercialDocumentId,
    fileName,
    contentType: "application/pdf",
    sizeBytes,
    sha256,
    storagePath,
    category: "QUOTE",
    versionLabel: `V${saisie.quote.version}`,
    variantLabel: saisie.quote.variantName,
    isCurrent: true,
    isSignedQuote: false,
    uploadedAt: archivedAt,
    uploadedByName: saisie.actorName,
  };

  return { finalPdf, commercialDocument, created };
}
