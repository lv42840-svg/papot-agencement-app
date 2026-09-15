import { z } from "zod";
import {
  QUOTE_DEFAULT_VALIDITY_DAYS,
  QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH,
  parseQuoteQuantityInput,
  quoteMoneyCentsSchema,
} from "./domain";
import {
  calculateQuoteOuvrageUnitPriceCents,
  parseQuoteModel,
  quoteDateSchema,
  type QuoteLibraryComponentSource,
  type QuoteLine,
  type QuoteOuvrageComponent,
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

const ouvrageComponentMutationSchema = z.object({
  id: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(4000),
  unit: z.string().trim().max(40),
  quantityInput: z.string().trim().min(1).max(QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH),
  unitPriceCents: quoteMoneyCentsSchema,
});

const upsertOuvrageMutationSchema = z.object({
  action: z.literal("upsertOuvrage"),
  quoteId: z.string().uuid(),
  lineId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(4000),
  unit: z.string().trim().max(40).default("u"),
  quantityInput: z.string().trim().min(1).max(QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH),
  components: z.array(ouvrageComponentMutationSchema).min(1).max(200),
});

export const quotesMutationSchema = z.discriminatedUnion("action", [
  createDraftMutationSchema,
  upsertLineMutationSchema,
  upsertOuvrageMutationSchema,
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

function findDraftLine(payload: NativeQuotesPayload, quoteId: string, lineId?: string) {
  const quoteIndex = payload.quotes.findIndex((quote) => quote.id === quoteId);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");

  const quote = payload.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");

  let existingLine: QuoteLine | undefined;
  let existingIndex = -1;
  if (lineId) {
    existingIndex = quote.model.items.findIndex((item) => item.id === lineId);
    if (existingIndex < 0 || quote.model.items[existingIndex].kind !== "LINE") {
      throw new Error("QUOTE_LINE_NOT_FOUND");
    }
    existingLine = quote.model.items[existingIndex] as QuoteLine;
  }

  return { quoteIndex, quote, existingLine, existingIndex };
}

function saveDraftLine(
  payload: NativeQuotesPayload,
  quoteIndex: number,
  line: QuoteLine,
  existingIndex: number,
  actor: QuotesActor,
  now: Date,
): QuotesMutationResult {
  const quote = payload.quotes[quoteIndex];
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

function upsertDraftLine(
  payload: NativeQuotesPayload,
  input: Extract<QuotesMutation, { action: "upsertLine" }>,
  actor: QuotesActor,
  now: Date,
  librarySource?: QuoteLibraryComponentSource,
): QuotesMutationResult {
  const { quoteIndex, existingLine, existingIndex } = findDraftLine(
    payload,
    input.quoteId,
    input.lineId,
  );
  const parsedQuantity = parseQuoteQuantityInput(input.quantityInput);

  const line: QuoteLine = {
    id: input.lineId ?? globalThis.crypto.randomUUID(),
    kind: "LINE",
    parentId: existingLine?.parentId ?? null,
    description: input.description,
    unit: input.unit,
    quantity: parsedQuantity.quantity,
    quantityFormula: parsedQuantity.formula,
    unitPriceCents: input.unitPriceCents,
    components: [],
    ...(librarySource
      ? { librarySource }
      : existingLine?.librarySource
        ? { librarySource: existingLine.librarySource }
        : {}),
  };

  return saveDraftLine(payload, quoteIndex, line, existingIndex, actor, now);
}

function upsertDraftOuvrage(
  payload: NativeQuotesPayload,
  input: Extract<QuotesMutation, { action: "upsertOuvrage" }>,
  actor: QuotesActor,
  now: Date,
): QuotesMutationResult {
  const { quoteIndex, existingLine, existingIndex } = findDraftLine(
    payload,
    input.quoteId,
    input.lineId,
  );
  const parsedQuantity = parseQuoteQuantityInput(input.quantityInput);
  const existingComponents = new Map(
    (existingLine?.components ?? []).map((component) => [component.id, component]),
  );

  const components: QuoteOuvrageComponent[] = input.components.map((componentInput) => {
    const parsedComponentQuantity = parseQuoteQuantityInput(componentInput.quantityInput);
    const existingComponent = componentInput.id
      ? existingComponents.get(componentInput.id)
      : undefined;
    return {
      id: componentInput.id ?? globalThis.crypto.randomUUID(),
      description: componentInput.description,
      unit: componentInput.unit,
      quantity: parsedComponentQuantity.quantity,
      quantityFormula: parsedComponentQuantity.formula,
      unitPriceCents: componentInput.unitPriceCents,
      ...(existingComponent?.librarySource
        ? { librarySource: existingComponent.librarySource }
        : {}),
    };
  });

  const line: QuoteLine = {
    id: input.lineId ?? globalThis.crypto.randomUUID(),
    kind: "LINE",
    parentId: existingLine?.parentId ?? null,
    description: input.description,
    unit: input.unit,
    quantity: parsedQuantity.quantity,
    quantityFormula: parsedQuantity.formula,
    unitPriceCents: calculateQuoteOuvrageUnitPriceCents(components),
    components,
    ...(existingLine?.librarySource ? { librarySource: existingLine.librarySource } : {}),
  };

  return saveDraftLine(payload, quoteIndex, line, existingIndex, actor, now);
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
  if (input.action === "upsertOuvrage") {
    return upsertDraftOuvrage(payload, input, actor, now);
  }
  return upsertDraftLine(payload, input, actor, now, librarySource);
}
