import { z } from "zod";
import {
  QUOTE_DEFAULT_VALIDITY_DAYS,
  QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH,
  parseQuoteQuantityInput,
  quoteMoneyCentsSchema,
} from "./domain";
import {
  parseQuoteModel,
  quoteDateSchema,
  type QuoteLibraryComponentSource,
  type QuoteLine,
} from "./model";
import {
  nativeQuoteRecordSchema,
  parseNativeQuotesPayload,
  type NativeQuotesPayload,
} from "./store";

const createDraftMutationSchema = z.object({
  action: z.literal("createDraft"),
  commercialCaseId: z.string().uuid(),
  subject: z.string().trim().min(1).max(240),
  issueDate: quoteDateSchema,
  variantName: z.string().trim().min(1).max(120).default("Base"),
  paymentTerms: z.string().trim().min(1).max(1000),
});

const upsertLineMutationSchema = z.object({
  action: z.literal("upsertLine"),
  quoteId: z.string().uuid(),
  lineId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(4000),
  unit: z.string().trim().max(40),
  quantityInput: z.string().trim().min(1).max(QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH),
  unitPriceCents: quoteMoneyCentsSchema,
  saveToLibrary: z.boolean().default(false),
  libraryName: z.string().trim().min(1).max(240).optional(),
  libraryCostPriceCents: quoteMoneyCentsSchema.optional(),
});

export const quotesMutationSchema = z.discriminatedUnion("action", [
  createDraftMutationSchema,
  upsertLineMutationSchema,
]);

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

function createDraft(
  payload: NativeQuotesPayload,
  input: Extract<QuotesMutation, { action: "createDraft" }>,
  actor: QuotesActor,
  clientId: string | undefined,
  now: Date,
): QuotesMutationResult {
  if (!clientId) throw new Error("QUOTE_CLIENT_NOT_FOUND");

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

function upsertDraftLine(
  payload: NativeQuotesPayload,
  input: Extract<QuotesMutation, { action: "upsertLine" }>,
  actor: QuotesActor,
  now: Date,
  librarySource?: QuoteLibraryComponentSource,
): QuotesMutationResult {
  const quoteIndex = payload.quotes.findIndex((quote) => quote.id === input.quoteId);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");

  const quote = payload.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");

  const parsedQuantity = parseQuoteQuantityInput(input.quantityInput);
  let existingLine: QuoteLine | undefined;
  let existingIndex = -1;
  if (input.lineId) {
    existingIndex = quote.model.items.findIndex((item) => item.id === input.lineId);
    if (existingIndex < 0 || quote.model.items[existingIndex].kind !== "LINE") {
      throw new Error("QUOTE_LINE_NOT_FOUND");
    }
    existingLine = quote.model.items[existingIndex] as QuoteLine;
  }

  const line: QuoteLine = {
    id: input.lineId ?? globalThis.crypto.randomUUID(),
    kind: "LINE",
    parentId: existingLine?.parentId ?? null,
    description: input.description,
    unit: input.unit,
    quantity: parsedQuantity.quantity,
    quantityFormula: parsedQuantity.formula,
    unitPriceCents: input.unitPriceCents,
    ...(librarySource
      ? { librarySource }
      : existingLine?.librarySource
        ? { librarySource: existingLine.librarySource }
        : {}),
  };

  const items = [...quote.model.items];
  if (existingIndex >= 0) items[existingIndex] = line;
  else items.push(line);

  const timestamp = now.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    model: parseQuoteModel({ ...quote.model, items }),
    updatedAt: timestamp,
    updatedByName: actor.displayName,
  });
  payload.quotes[quoteIndex] = updated;
  return { payload, focusQuoteId: updated.id };
}

export function applyQuotesMutation(
  source: NativeQuotesPayload,
  input: QuotesMutation,
  actor: QuotesActor,
  clientId?: string,
  now: Date = new Date(),
  librarySource?: QuoteLibraryComponentSource,
): QuotesMutationResult {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  if (input.action === "createDraft") {
    return createDraft(payload, input, actor, clientId, now);
  }
  return upsertDraftLine(payload, input, actor, now, librarySource);
}
