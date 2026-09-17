import { assertPdfBuffer, convertDocxToPdfWithLibreOffice } from "../documents/pdf-runtime";
import type { QuoteDocumentData } from "./document-data";
import {
  generateQuoteWordV2FilledDocxFromSources,
  renderQuoteWordV2FilledDocx,
} from "./word-v2-filled-docx";
import type {
  QuoteDocumentDataMappingInput,
  QuoteDocumentDataSources,
} from "./document-data-mapping";

export type QuoteWordV2PdfConverter = (docx: Uint8Array) => Promise<Uint8Array>;

export type GeneratedQuoteWordV2Pdf = {
  document: QuoteDocumentData;
  docx: Uint8Array;
  pdf: Uint8Array;
};

const pdfRequiredFields = [
  ["devis_numero", (document: QuoteDocumentData) => document.quote.number],
  ["devis_date", (document: QuoteDocumentData) => document.quote.issueDate],
  ["devis_validite", (document: QuoteDocumentData) => document.quote.validityDate],
  ["travaux_debut", (document: QuoteDocumentData) => document.quote.workStartDate],
  ["travaux_duree", (document: QuoteDocumentData) => document.quote.workDuration],
  ["travaux_fin_limite", (document: QuoteDocumentData) => document.quote.workEndDate],
  ["client_raison_sociale", (document: QuoteDocumentData) => document.client.displayName],
  ["conditions_paiement", (document: QuoteDocumentData) => document.quote.paymentTerms],
] as const;

export function assertQuoteWordV2PdfReady(document: QuoteDocumentData): void {
  const missing = pdfRequiredFields
    .filter(([, read]) => !read(document).trim())
    .map(([field]) => field);
  if (missing.length > 0) {
    throw new Error(`QUOTE_WORD_V2_PDF_REQUIRED_FIELDS:${missing.join(",")}`);
  }
}

export async function renderQuoteWordV2Pdf(
  template: Uint8Array,
  document: QuoteDocumentData,
  converter: QuoteWordV2PdfConverter = convertDocxToPdfWithLibreOffice,
): Promise<GeneratedQuoteWordV2Pdf> {
  assertQuoteWordV2PdfReady(document);
  const docx = renderQuoteWordV2FilledDocx(template, document);
  const pdf = await converter(docx);
  assertPdfBuffer(pdf);
  return { document, docx, pdf };
}

export async function generateQuoteWordV2PdfFromSources(
  template: Uint8Array,
  input: QuoteDocumentDataMappingInput,
  sources: QuoteDocumentDataSources,
  converter: QuoteWordV2PdfConverter = convertDocxToPdfWithLibreOffice,
): Promise<GeneratedQuoteWordV2Pdf> {
  const generated = await generateQuoteWordV2FilledDocxFromSources(template, input, sources);
  assertQuoteWordV2PdfReady(generated.document);
  const pdf = await converter(generated.docx);
  assertPdfBuffer(pdf);
  return { ...generated, pdf };
}
