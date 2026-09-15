import { calculateQuoteAdjustedPricing } from "./adjustments";
import {
  assertQuotePricingIntegrity,
  normalizeQuotePricingAfterModelMutation,
} from "./pricing-integrity";
import {
  nativeQuoteRecordSchema,
  parseNativeQuotesPayload,
  type NativeQuotesPayload,
} from "./store";

export type QuoteSendActor = {
  userId: string;
  displayName: string;
};

export function markNativeQuoteSent(
  source: NativeQuotesPayload,
  quoteId: string,
  followUpDate: string,
  actor: QuoteSendActor,
  now: Date = new Date(),
): { payload: NativeQuotesPayload; focusQuoteId: string; commercialCaseId: string } {
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

  const timestamp = now.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    status: "SENT",
    sentAt: timestamp,
    followUpDate,
    updatedAt: timestamp,
    updatedByName: actor.displayName,
  });
  payload.quotes[quoteIndex] = updated;

  return {
    payload,
    focusQuoteId: updated.id,
    commercialCaseId: updated.commercialCaseId,
  };
}
