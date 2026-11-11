import { calculateQuoteAdjustedPricing } from "./adjustments";
import {
  assertQuotePricingIntegrity,
  normalizeQuotePricingAfterModelMutation,
} from "./pricing-integrity";
import {
  nativeQuoteRecordSchema,
  parseNativeQuotesPayload,
  type NativeQuoteRecord,
  type NativeQuotesPayload,
  type QuoteFinalPdf,
} from "./store";

export type QuoteSendActor = {
  userId: string;
  displayName: string;
};

type PreparedQuote = {
  payload: NativeQuotesPayload;
  quoteIndex: number;
  quote: NativeQuoteRecord;
};

function prepareDraftQuote(source: NativeQuotesPayload, idDevis: string): PreparedQuote {
  const contenu = structuredClone(parseNativeQuotesPayload(source));
  normalizeQuotePricingAfterModelMutation(contenu, idDevis);

  const quoteIndex = contenu.quotes.findIndex((quote) => quote.id === idDevis);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");

  const quote = contenu.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");

  assertQuotePricingIntegrity(quote.model.items, quote.pricingConfig);
  const pricing = calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig);
  if (pricing.warnings.length > 0) throw new Error("QUOTE_PRICING_REVIEW_REQUIRED");

  return { payload: contenu, quoteIndex, quote };
}

function prepareFrozenQuote(source: NativeQuotesPayload, idDevis: string): PreparedQuote {
  const contenu = structuredClone(parseNativeQuotesPayload(source));
  const quoteIndex = contenu.quotes.findIndex((quote) => quote.id === idDevis);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");
  const quote = contenu.quotes[quoteIndex];
  if (quote.status !== "FROZEN" || !quote.finalPdf) {
    throw new Error("QUOTE_NOT_FROZEN");
  }
  return { payload: contenu, quoteIndex, quote };
}

function assertFollowUpDate(followUpDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)) {
    throw new Error("QUOTE_FOLLOW_UP_DATE_REQUIRED");
  }
}

function assertFinalPdfMatchesQuote(quote: NativeQuoteRecord, finalPdf: QuoteFinalPdf) {
  if (finalPdf.variantName !== quote.variantName) {
    throw new Error("QUOTE_FINAL_PDF_VARIANT_MISMATCH");
  }
  if (finalPdf.version !== quote.version) {
    throw new Error("QUOTE_FINAL_PDF_VERSION_MISMATCH");
  }
}

function result(prepared: PreparedQuote, updated: NativeQuoteRecord) {
  prepared.payload.quotes[prepared.quoteIndex] = updated;
  return {
    payload: prepared.payload,
    focusQuoteId: updated.id,
    commercialCaseId: updated.commercialCaseId,
  };
}

export function markNativeQuoteValidatedWithFinalPdf(
  source: NativeQuotesPayload,
  idDevis: string,
  finalPdf: QuoteFinalPdf,
  auteur: QuoteSendActor,
  maintenant: Date = new Date(),
): { payload: NativeQuotesPayload; focusQuoteId: string; commercialCaseId: string } {
  const prepared = prepareDraftQuote(source, idDevis);
  assertFinalPdfMatchesQuote(prepared.quote, finalPdf);
  const timestamp = maintenant.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...prepared.quote,
    status: "FROZEN",
    sentAt: null,
    followUpDate: null,
    finalPdf,
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });
  return result(prepared, updated);
}

export function markNativeQuoteSent(
  source: NativeQuotesPayload,
  idDevis: string,
  followUpDate: string,
  auteur: QuoteSendActor,
  maintenant: Date = new Date(),
): { payload: NativeQuotesPayload; focusQuoteId: string; commercialCaseId: string } {
  assertFollowUpDate(followUpDate);
  const prepared = prepareDraftQuote(source, idDevis);
  const timestamp = maintenant.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...prepared.quote,
    status: "SENT",
    sentAt: timestamp,
    followUpDate,
    finalPdf: null,
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });
  return result(prepared, updated);
}

export function markNativeQuoteSentWithFinalPdf(
  source: NativeQuotesPayload,
  idDevis: string,
  followUpDate: string,
  finalPdf: QuoteFinalPdf,
  auteur: QuoteSendActor,
  maintenant: Date = new Date(),
): { payload: NativeQuotesPayload; focusQuoteId: string; commercialCaseId: string } {
  assertFollowUpDate(followUpDate);
  const prepared = prepareDraftQuote(source, idDevis);
  assertFinalPdfMatchesQuote(prepared.quote, finalPdf);
  const timestamp = maintenant.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...prepared.quote,
    status: "SENT",
    sentAt: timestamp,
    followUpDate,
    finalPdf,
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });
  return result(prepared, updated);
}

export function markFrozenNativeQuoteSent(
  source: NativeQuotesPayload,
  idDevis: string,
  followUpDate: string,
  auteur: QuoteSendActor,
  maintenant: Date = new Date(),
): { payload: NativeQuotesPayload; focusQuoteId: string; commercialCaseId: string } {
  assertFollowUpDate(followUpDate);
  const prepared = prepareFrozenQuote(source, idDevis);
  const timestamp = maintenant.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...prepared.quote,
    status: "SENT",
    sentAt: timestamp,
    followUpDate,
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });
  return result(prepared, updated);
}
