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

type PreparedQuoteSend = {
  payload: NativeQuotesPayload;
  quoteIndex: number;
  quote: NativeQuoteRecord;
};

function prepareQuoteSend(
  source: NativeQuotesPayload,
  quoteId: string,
  followUpDate: string,
): PreparedQuoteSend {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  normalizeQuotePricingAfterModelMutation(payload, quoteId);

  const quoteIndex = payload.quotes.findIndex((quote) => quote.id === quoteId);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");

  const quote = payload.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)) throw new Error("QUOTE_FOLLOW_UP_DATE_REQUIRED");

  assertQuotePricingIntegrity(quote.model.items, quote.pricingConfig);
  const pricing = calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig);
  if (pricing.warnings.length > 0) throw new Error("QUOTE_PRICING_REVIEW_REQUIRED");

  return { payload, quoteIndex, quote };
}

function commitSentQuote(
  prepared: PreparedQuoteSend,
  followUpDate: string,
  actor: QuoteSendActor,
  now: Date,
  finalPdf: QuoteFinalPdf | null,
): { payload: NativeQuotesPayload; focusQuoteId: string; commercialCaseId: string } {
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
  prepared.payload.quotes[prepared.quoteIndex] = updated;

  return {
    payload: prepared.payload,
    focusQuoteId: updated.id,
    commercialCaseId: updated.commercialCaseId,
  };
}

export function markNativeQuoteSent(
  source: NativeQuotesPayload,
  quoteId: string,
  followUpDate: string,
  actor: QuoteSendActor,
  now: Date = new Date(),
): { payload: NativeQuotesPayload; focusQuoteId: string; commercialCaseId: string } {
  const prepared = prepareQuoteSend(source, quoteId, followUpDate);
  return commitSentQuote(prepared, followUpDate, actor, now, null);
}

export function markNativeQuoteSentWithFinalPdf(
  source: NativeQuotesPayload,
  quoteId: string,
  followUpDate: string,
  finalPdf: QuoteFinalPdf,
  actor: QuoteSendActor,
  now: Date = new Date(),
): { payload: NativeQuotesPayload; focusQuoteId: string; commercialCaseId: string } {
  const prepared = prepareQuoteSend(source, quoteId, followUpDate);
  if (finalPdf.variantName !== prepared.quote.variantName) {
    throw new Error("QUOTE_FINAL_PDF_VARIANT_MISMATCH");
  }
  if (finalPdf.version !== prepared.quote.version) {
    throw new Error("QUOTE_FINAL_PDF_VERSION_MISMATCH");
  }
  return commitSentQuote(prepared, followUpDate, actor, now, finalPdf);
}
