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
  idDevis: string,
  saisie: QuoteInternalNotesInput,
  auteur: { displayName: string },
  maintenant: Date = new Date(),
) {
  const contenu = structuredClone(parseNativeQuotesPayload(source));
  const quoteIndex = contenu.quotes.findIndex((quote) => quote.id === idDevis);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");

  const quote = contenu.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");

  const { internalNotes } = quoteInternalNotesSchema.parse(saisie);
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    internalNotes,
    updatedAt: maintenant.toISOString(),
    updatedByName: auteur.displayName,
  });

  contenu.quotes[quoteIndex] = updated;
  return { payload: contenu, focusQuoteId: updated.id };
}
