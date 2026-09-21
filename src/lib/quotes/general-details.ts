import { z } from "zod";
import { QUOTE_DEFAULT_VALIDITY_DAYS } from "./domain";
import { parseQuoteModel, quoteDateSchema } from "./model";
import {
  nativeQuoteRecordSchema,
  parseNativeQuotesPayload,
  type NativeQuotesPayload,
} from "./store";

export const quoteGeneralDetailsSchema = z
  .object({
    subject: z.string().trim().min(1).max(240),
    issueDate: quoteDateSchema,
    paymentTerms: z.string().trim().min(1).max(1000),
  })
  .strict();

export type QuoteGeneralDetailsInput = z.infer<typeof quoteGeneralDetailsSchema>;

export type QuoteGeneralDetailsActor = {
  displayName: string;
};

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
  const timestamp = now.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    model: parseQuoteModel({
      ...quote.model,
      subject: details.subject,
      issueDate: details.issueDate,
      validityDays: QUOTE_DEFAULT_VALIDITY_DAYS,
      paymentTerms: details.paymentTerms,
    }),
    updatedAt: timestamp,
    updatedByName: actor.displayName,
  });

  payload.quotes[quoteIndex] = updated;
  return { payload, focusQuoteId: updated.id };
}
