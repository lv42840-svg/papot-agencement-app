import { z } from "zod";
import { QUOTE_DEFAULT_VALIDITY_DAYS } from "./domain";
import { parseQuoteModel, quoteDateSchema } from "./model";
import {
  nativeQuoteRecordSchema,
  parseNativeQuotesPayload,
  type NativeQuotesPayload,
} from "./store";

export const quotesMutationSchema = z.object({
  action: z.literal("createDraft"),
  commercialCaseId: z.string().uuid(),
  subject: z.string().trim().min(1).max(240),
  issueDate: quoteDateSchema,
  variantName: z.string().trim().min(1).max(120).default("Base"),
  paymentTerms: z.string().trim().min(1).max(1000),
});

export type QuotesMutation = z.infer<typeof quotesMutationSchema>;

export type QuotesActor = {
  userId: string;
  displayName: string;
};

export type QuotesMutationResult = {
  payload: NativeQuotesPayload;
  focusQuoteId: string;
};

function sameVariant(left: string, right: string): boolean {
  return left.localeCompare(right, "fr-FR", { sensitivity: "base" }) === 0;
}

function nextVariantVersion(
  payload: NativeQuotesPayload,
  commercialCaseId: string,
  variantName: string,
): number {
  return (
    payload.quotes.reduce((highest, quote) => {
      if (
        quote.commercialCaseId !== commercialCaseId ||
        !sameVariant(quote.variantName, variantName)
      ) {
        return highest;
      }
      return Math.max(highest, quote.version);
    }, 0) + 1
  );
}

export function applyQuotesMutation(
  source: NativeQuotesPayload,
  input: QuotesMutation,
  actor: QuotesActor,
  clientId: string,
  now: Date = new Date(),
): QuotesMutationResult {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  const quoteId = globalThis.crypto.randomUUID();
  const timestamp = now.toISOString();
  const version = nextVariantVersion(payload, input.commercialCaseId, input.variantName);
  const model = parseQuoteModel({
    id: quoteId,
    clientId,
    subject: input.subject,
    issueDate: input.issueDate,
    validityDays: QUOTE_DEFAULT_VALIDITY_DAYS,
    paymentTerms: input.paymentTerms,
    items: [],
  });

  const record = nativeQuoteRecordSchema.parse({
    id: quoteId,
    commercialCaseId: input.commercialCaseId,
    variantName: input.variantName,
    version,
    status: "DRAFT",
    model,
    createdAt: timestamp,
    createdByName: actor.displayName,
    updatedAt: timestamp,
    updatedByName: actor.displayName,
  });

  payload.quotes.push(record);
  return { payload, focusQuoteId: quoteId };
}
