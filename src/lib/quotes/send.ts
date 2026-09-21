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

function prepareDraftQuote(source: NativeQuotesPayload, quoteId: string): PreparedQuote {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  normalizeQuotePricingAfterModelMutation(payload, quoteId);

  const quoteIndex = payload.quotes.findIndex((quote) => quote.id === quoteId);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");

  const quote = payload.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");

  assertQuotePricingIntegrity(quote.model.items, quote.pricingConfig);
  const pricing = calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig);
  if (pricing.warnings.length > 0) throw new Error("QUOTE_PRICING_REVIEW_REQUIRED");

  return { payload, quoteIndex, quote };
}

function prepareFrozenQuote(source: NativeQuotesPayload, quoteId: string): PreparedQuote {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  const quoteIndex = payload.quotes.findIndex((quote) => quote.id === quoteId);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");
  const quote = payload.quotes[quoteIndex];
  if (quote.status !== "FROZEN" || !quote.finalPdf) {
    throw new Error("QUOTE_NOT_FROZEN");
  }
  return { payload, quoteIndex, quote };
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
  quoteId: string,
  finalPdf: QuoteFinalPdf,
  actor: QuoteSendActor,
  now: Date = new Date(),
): { payload: NativeQuotesPayload; focusQuoteId: string; commercialCaseId: string } {
  const prepared = prepareDraftQuote(source, quoteId);
  assertFinalPdfMatchesQuote(prepared.quote, finalPdf);
  const timestamp = now.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...prepared.quote,
    status: "FROZEN",
    sentAt: null,
    followUpDate: null,
    finalPdf,
    updatedAt: timestamp,
    updatedByName: actor.displayName,
  });
  return result(prepared, updated);
}

export function markNativeQuoteSent(
  source: NativeQuotesPayload,
  quoteId: string,
  followUpDate: string,
  actor: QuoteSendActor,
  now: Date = new Date(),
): { payload: NativeQuotesPayload; focusQuoteId: string; commercialCaseId: string } {
  assertFollowUpDate(followUpDate);
  const prepared = prepareDraftQuote(source, quoteId);
  const timestamp = now.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...prepared.quote,
    status: "SENT",
    sentAt: timestamp,
    followUpDate,
    finalPdf: null,
    updatedAt: timestamp,
    updatedByName: actor.displayName,
  });
  return result(prepared, updated);
}

export function markNativeQuoteSentWithFinalPdf(
  source: NativeQuotesPayload,
  quoteId: string,
  followUpDate: string,
  finalPdf: QuoteFinalPdf,
  actor: QuoteSendActor,
  now: Date = new Date(),
): { payload: NativeQuotesPayload; focusQuoteId: string; commercialCaseId: string } {
  assertFollowUpDate(followUpDate);
  const prepared = prepareDraftQuote(source, quoteId);
  assertFinalPdfMatchesQuote(prepared.quote, finalPdf);
  const timestamp = now.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...prepared.quote,
    status: "SENT",
    sentAt: timestamp,
    followUpDate,
    finalPdf,
    updatedAt: timestamp,
    updatedByName: actor.displayName,
  });
  return result(prepared, updated);
}

export function markFrozenNativeQuoteSent(
  source: NativeQuotesPayload,
  quoteId: string,
  followUpDate: string,
  actor: QuoteSendActor,
  now: Date = new Date(),
): { payload: NativeQuotesPayload; focusQuoteId: string; commercialCaseId: string } {
  assertFollowUpDate(followUpDate);
  const prepared = prepareFrozenQuote(source, quoteId);
  const timestamp = now.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...prepared.quote,
    status: "SENT",
    sentAt: timestamp,
    followUpDate,
    updatedAt: timestamp,
    updatedByName: actor.displayName,
  });
  return result(prepared, updated);
}
