import { z } from "zod";
import { parseQuoteModel, quoteDateSchema } from "./model";
import {
  nativeQuoteRecordSchema,
  parseNativeQuotesPayload,
  type NativeQuotesPayload,
} from "./store";

export const quoteGeneralDetailsSchema = z
  .object({
    subject: z.string().trim().min(1).max(240),
    variantName: z.string().trim().min(1).max(120),
    issueDate: quoteDateSchema,
    validityDays: z.number().int().min(1).max(365),
    paymentTerms: z.string().trim().min(1).max(1000),
  })
  .strict();

export type QuoteGeneralDetailsInput = z.infer<typeof quoteGeneralDetailsSchema>;

export type QuoteGeneralDetailsActor = {
  displayName: string;
};

function sameVariant(left: string, right: string): boolean {
  return left.localeCompare(right, "fr-FR", { sensitivity: "base" }) === 0;
}

export function updateDraftQuoteGeneralDetails(
  source: NativeQuotesPayload,
  quoteId: string,
  detailsInput: QuoteGeneralDetailsInput,
  actor: QuoteGeneralDetailsActor,
  now: Date = new Date(),
) {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  const quoteIndex = payload.quotes.findIndex((quote) => quote.id === quoteId);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");

  const quote = payload.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");

  const details = quoteGeneralDetailsSchema.parse(detailsInput);
  const variantConflict = payload.quotes.some(
    (candidate) =>
      candidate.id !== quote.id &&
      candidate.commercialCaseId === quote.commercialCaseId &&
      candidate.version === quote.version &&
      sameVariant(candidate.variantName, details.variantName),
  );
  if (variantConflict) throw new Error("QUOTE_VARIANT_VERSION_CONFLICT");

  const timestamp = now.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    variantName: details.variantName,
    model: parseQuoteModel({
      ...quote.model,
      subject: details.subject,
      issueDate: details.issueDate,
      validityDays: details.validityDays,
      paymentTerms: details.paymentTerms,
    }),
    updatedAt: timestamp,
    updatedByName: actor.displayName,
  });

  payload.quotes[quoteIndex] = updated;
  return { payload, focusQuoteId: updated.id };
}
