import { z } from "zod";
import {
  nativeQuoteRecordSchema,
  parseNativeQuotesPayload,
  type NativeQuotesPayload,
} from "./store";

export const quoteInternalNotesSchema = z
  .object({
    internalNotes: z.string().max(20_000),
  })
  .strict();

export type QuoteInternalNotesInput = z.infer<typeof quoteInternalNotesSchema>;

export function updateDraftQuoteInternalNotes(
  source: NativeQuotesPayload,
  quoteId: string,
  input: QuoteInternalNotesInput,
  actor: { displayName: string },
  now: Date = new Date(),
) {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  const quoteIndex = payload.quotes.findIndex((quote) => quote.id === quoteId);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");

  const quote = payload.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");

  const { internalNotes } = quoteInternalNotesSchema.parse(input);
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    internalNotes,
    updatedAt: now.toISOString(),
    updatedByName: actor.displayName,
  });

  payload.quotes[quoteIndex] = updated;
  return { payload, focusQuoteId: updated.id };
}
