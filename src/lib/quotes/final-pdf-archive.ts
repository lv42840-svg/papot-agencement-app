import { randomUUID } from "node:crypto";
import type { CommercialDocument } from "@/lib/commercial/domain";
import {
  commercialDocumentFileName,
  commercialDocumentStoragePath,
} from "@/lib/commercial/document-path";
import { assertPdfBuffer } from "@/lib/documents/pdf-runtime";
import { sha256Bytes, type ServerFileStore } from "@/lib/server-files/storage";
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

function existingSequence(quoteNumber: string, year: number): number | null {
  const match = quoteNumber.match(FINAL_QUOTE_NUMBER_PATTERN);
  if (!match || Number(match[1]) !== year) return null;
  return Number(match[2]);
}

export function nextFinalQuoteNumber(payload: NativeQuotesPayload, year: number): string {
  const highest = payload.quotes.reduce((current, quote) => {
    const sequence = quote.finalPdf ? existingSequence(quote.finalPdf.quoteNumber, year) : null;
    return sequence === null ? current : Math.max(current, sequence);
  }, 0);
  return formatQuoteNumber(year, highest + 1);
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
  context: QuoteFinalPdfArchiveContext,
  quote: Pick<NativeQuoteRecord, "variantName" | "version">,
  quoteNumber: string,
): string {
  return commercialDocumentStoragePath({
    creationYear: context.creationYear,
    clientName: context.clientName,
    caseName: context.caseName,
    category: "QUOTE",
    fileName: quoteFinalPdfFileName(quote, quoteNumber),
  });
}

function isExistingFileError(error: unknown): boolean {
  return error instanceof Error && error.message === "SERVER_FILE_EXISTS";
}

export async function archiveFinalQuotePdf(
  store: ServerFileStore,
  input: {
    quote: Pick<NativeQuoteRecord, "variantName" | "version">;
    quoteNumber: string;
    context: QuoteFinalPdfArchiveContext;
    pdf: Uint8Array;
    actorName: string;
    now?: Date;
  },
): Promise<QuoteFinalPdfArchiveResult> {
  assertPdfBuffer(input.pdf);
  const now = input.now ?? new Date();
  const fileName = quoteFinalPdfFileName(input.quote, input.quoteNumber);
  const storagePath = quoteFinalPdfStoragePath(
    input.context,
    input.quote,
    input.quoteNumber,
  );
  const expectedSha256 = sha256Bytes(input.pdf);
  let created = true;
  let sizeBytes = input.pdf.byteLength;
  let sha256 = expectedSha256;

  try {
    const written = await store.writeBytes(storagePath, input.pdf);
    sizeBytes = written.sizeBytes;
    sha256 = written.sha256;
  } catch (error) {
    if (!isExistingFileError(error)) throw error;
    const existing = await store.readBytes(storagePath);
    if (existing.byteLength !== input.pdf.byteLength || sha256Bytes(existing) !== expectedSha256) {
      throw new Error("QUOTE_FINAL_PDF_ARCHIVE_CONFLICT");
    }
    assertPdfBuffer(existing);
    created = false;
    sizeBytes = existing.byteLength;
    sha256 = expectedSha256;
  }

  const commercialDocumentId = randomUUID();
  const archivedAt = now.toISOString();
  const finalPdf: QuoteFinalPdf = {
    quoteNumber: input.quoteNumber,
    variantName: input.quote.variantName,
    version: input.quote.version,
    commercialDocumentId,
    fileName,
    storagePath,
    sizeBytes,
    sha256,
    archivedAt,
    archivedByName: input.actorName,
  };
  const commercialDocument: CommercialDocument = {
    id: commercialDocumentId,
    fileName,
    contentType: "application/pdf",
    sizeBytes,
    sha256,
    storagePath,
    category: "QUOTE",
    versionLabel: `V${input.quote.version}`,
    variantLabel: input.quote.variantName,
    isCurrent: true,
    isSignedQuote: false,
    uploadedAt: archivedAt,
    uploadedByName: input.actorName,
  };

  return { finalPdf, commercialDocument, created };
}
