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
  type QuoteItem,
  type QuoteLibraryComponentSource,
  type QuoteLine,
  type QuoteOuvrageComponent,
  type QuoteSection,
  type QuoteSubsection,
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
  libraryComponentId: z.string().uuid().optional(),
  description: z.string().trim().min(1).max(4000),
  unit: z.string().trim().max(40),
  quantityInput: z.string().trim().min(1).max(QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH),
  costPriceCents: quoteMoneyCentsSchema.optional(),
  unitPriceCents: quoteMoneyCentsSchema,
});

const upsertOuvrageMutationSchema = z.object({
  action: z.literal("upsertOuvrage"),
  quoteId: z.string().uuid(),
  lineId: z.string().uuid().optional(),
  parentId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(4000),
  unit: z.string().trim().max(40).default("u"),
  quantityInput: z.string().trim().min(1).max(QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH),
  forcedUnitPriceCents: quoteMoneyCentsSchema.nullable().optional(),
  components: z.array(ouvrageComponentMutationSchema).min(1).max(200),
});

const duplicateLineMutationSchema = z.object({
  action: z.literal("duplicateLine"),
  quoteId: z.string().uuid(),
  lineId: z.string().uuid(),
});

const moveLineMutationSchema = z.object({
  action: z.literal("moveLine"),
  quoteId: z.string().uuid(),
  lineId: z.string().uuid(),
  direction: z.enum(["UP", "DOWN"]),
});

const moveHeadingMutationSchema = z.object({
  action: z.literal("moveHeading"),
  quoteId: z.string().uuid(),
  itemId: z.string().uuid(),
  direction: z.enum(["UP", "DOWN"]),
});

const duplicateHeadingMutationSchema = z.object({
  action: z.literal("duplicateHeading"),
  quoteId: z.string().uuid(),
  itemId: z.string().uuid(),
});

const deleteItemMutationSchema = z.object({
  action: z.literal("deleteItem"),
  quoteId: z.string().uuid(),
  itemId: z.string().uuid(),
});

const upsertSectionMutationSchema = z.object({
  action: z.literal("upsertSection"),
  quoteId: z.string().uuid(),
  itemId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(500),
});

const upsertSubsectionMutationSchema = z.object({
  action: z.literal("upsertSubsection"),
  quoteId: z.string().uuid(),
  itemId: z.string().uuid().optional(),
  parentId: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
});

export const quotesMutationSchema = z.discriminatedUnion("action", [
  createDraftMutationSchema,
  upsertLineMutationSchema,
  upsertOuvrageMutationSchema,
  duplicateLineMutationSchema,
  moveLineMutationSchema,
  moveHeadingMutationSchema,
  duplicateHeadingMutationSchema,
  deleteItemMutationSchema,
  upsertSectionMutationSchema,
  upsertSubsectionMutationSchema,
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

function findDraftQuote(payload: NativeQuotesPayload, quoteId: string) {
  const quoteIndex = payload.quotes.findIndex((quote) => quote.id === quoteId);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");

  const quote = payload.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");
  return { quoteIndex, quote };
}

function findDraftLine(payload: NativeQuotesPayload, quoteId: string, lineId?: string) {
  const { quoteIndex, quote } = findDraftQuote(payload, quoteId);

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

function saveDraftItem(
  payload: NativeQuotesPayload,
  quoteIndex: number,
  item: QuoteItem,
  existingIndex: number,
  actor: QuotesActor,
  now: Date,
): QuotesMutationResult {
  const quote = payload.quotes[quoteIndex];
  const items = [...quote.model.items];
  if (existingIndex >= 0) items[existingIndex] = item;
  else items.push(item);

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

function saveDraftLine(
  payload: NativeQuotesPayload,
  quoteIndex: number,
  line: QuoteLine,
  existingIndex: number,
  actor: QuotesActor,
  now: Date,
): QuotesMutationResult {
  return saveDraftItem(payload, quoteIndex, line, existingIndex, actor, now);
}

function duplicateDraftLine(
  payload: NativeQuotesPayload,
  input: Extract<QuotesMutation, { action: "duplicateLine" }>,
  actor: QuotesActor,
  now: Date,
): QuotesMutationResult {
  const { quoteIndex, quote, existingLine, existingIndex } = findDraftLine(
    payload,
    input.quoteId,
    input.lineId,
  );
  if (!existingLine || existingIndex < 0) throw new Error("QUOTE_LINE_NOT_FOUND");

  const duplicatedLine: QuoteLine = {
    ...structuredClone(existingLine),
    id: globalThis.crypto.randomUUID(),
    components: (existingLine.components ?? []).map((component) => ({
      ...structuredClone(component),
      id: globalThis.crypto.randomUUID(),
    })),
  };

  const items = [...quote.model.items];
  items.splice(existingIndex + 1, 0, duplicatedLine);
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

function moveDraftLine(
  payload: NativeQuotesPayload,
  input: Extract<QuotesMutation, { action: "moveLine" }>,
  actor: QuotesActor,
  now: Date,
): QuotesMutationResult {
  const { quoteIndex, quote, existingLine, existingIndex } = findDraftLine(
    payload,
    input.quoteId,
    input.lineId,
  );
  if (!existingLine || existingIndex < 0) throw new Error("QUOTE_LINE_NOT_FOUND");

  const targetIndex = input.direction === "UP" ? existingIndex - 1 : existingIndex + 1;
  const target = quote.model.items[targetIndex];
  if (!target || target.kind !== "LINE" || target.parentId !== existingLine.parentId) {
    throw new Error("QUOTE_LINE_MOVE_BLOCKED");
  }

  const items = [...quote.model.items];
  [items[existingIndex], items[targetIndex]] = [items[targetIndex], items[existingIndex]];
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

function headingBlockEnd(items: QuoteItem[], startIndex: number): number {
  const heading = items[startIndex];
  if (!heading || (heading.kind !== "SECTION" && heading.kind !== "SUBSECTION")) {
    return startIndex + 1;
  }

  for (let index = startIndex + 1; index < items.length; index += 1) {
    const candidate = items[index];
    if (candidate.kind === "SECTION") return index;
    if (
      heading.kind === "SUBSECTION" &&
      candidate.kind === "SUBSECTION" &&
      candidate.parentId === heading.parentId
    ) {
      return index;
    }
  }
  return items.length;
}

function deleteDraftItem(
  payload: NativeQuotesPayload,
  input: Extract<QuotesMutation, { action: "deleteItem" }>,
  actor: QuotesActor,
  now: Date,
): QuotesMutationResult {
  const { quoteIndex, quote } = findDraftQuote(payload, input.quoteId);
  const itemIndex = quote.model.items.findIndex((item) => item.id === input.itemId);
  if (itemIndex < 0) throw new Error("QUOTE_ITEM_NOT_FOUND");

  const item = quote.model.items[itemIndex];
  if (item.kind === "COMMENT") throw new Error("QUOTE_ITEM_DELETE_UNSUPPORTED");

  const deleteEnd =
    item.kind === "SECTION" || item.kind === "SUBSECTION"
      ? headingBlockEnd(quote.model.items, itemIndex)
      : itemIndex + 1;
  const items = [...quote.model.items.slice(0, itemIndex), ...quote.model.items.slice(deleteEnd)];
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

function previousHeadingSiblingIndex(
  items: QuoteItem[],
  currentIndex: number,
  heading: QuoteSection | QuoteSubsection,
): number {
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = items[index];
    if (heading.kind === "SECTION") {
      if (candidate.kind === "SECTION") return index;
      continue;
    }
    if (candidate.kind === "SECTION") return -1;
    if (candidate.kind === "SUBSECTION" && candidate.parentId === heading.parentId) return index;
  }
  return -1;
}

function duplicateDraftHeading(
  payload: NativeQuotesPayload,
  input: Extract<QuotesMutation, { action: "duplicateHeading" }>,
  actor: QuotesActor,
  now: Date,
): QuotesMutationResult {
  const { quoteIndex, quote } = findDraftQuote(payload, input.quoteId);
  const currentIndex = quote.model.items.findIndex((item) => item.id === input.itemId);
  if (currentIndex < 0) throw new Error("QUOTE_HEADING_NOT_FOUND");

  const heading = quote.model.items[currentIndex];
  if (heading.kind !== "SECTION" && heading.kind !== "SUBSECTION") {
    throw new Error("QUOTE_HEADING_NOT_FOUND");
  }

  const currentEnd = headingBlockEnd(quote.model.items, currentIndex);
  const sourceBlock = quote.model.items.slice(currentIndex, currentEnd);
  const newIds = new Map(sourceBlock.map((item) => [item.id, globalThis.crypto.randomUUID()]));
  const duplicatedBlock: QuoteItem[] = sourceBlock.map((item) => {
    const id = newIds.get(item.id);
    if (!id) throw new Error("QUOTE_HEADING_DUPLICATION_FAILED");

    if (item.kind === "SECTION") {
      return { ...structuredClone(item), id };
    }

    if (item.kind === "SUBSECTION") {
      return {
        ...structuredClone(item),
        id,
        parentId: newIds.get(item.parentId) ?? item.parentId,
      };
    }

    const parentId = item.parentId === null ? null : (newIds.get(item.parentId) ?? item.parentId);
    if (item.kind === "LINE") {
      return {
        ...structuredClone(item),
        id,
        parentId,
        components: item.components?.map((component) => ({
          ...structuredClone(component),
          id: globalThis.crypto.randomUUID(),
        })),
      };
    }

    return { ...structuredClone(item), id, parentId };
  });

  const items = [
    ...quote.model.items.slice(0, currentEnd),
    ...duplicatedBlock,
    ...quote.model.items.slice(currentEnd),
  ];
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

function moveDraftHeading(
  payload: NativeQuotesPayload,
  input: Extract<QuotesMutation, { action: "moveHeading" }>,
  actor: QuotesActor,
  now: Date,
): QuotesMutationResult {
  const { quoteIndex, quote } = findDraftQuote(payload, input.quoteId);
  const currentIndex = quote.model.items.findIndex((item) => item.id === input.itemId);
  if (currentIndex < 0) throw new Error("QUOTE_HEADING_NOT_FOUND");

  const heading = quote.model.items[currentIndex];
  if (heading.kind !== "SECTION" && heading.kind !== "SUBSECTION") {
    throw new Error("QUOTE_HEADING_NOT_FOUND");
  }

  const items = [...quote.model.items];
  const currentEnd = headingBlockEnd(items, currentIndex);
  let reordered: QuoteItem[];

  if (input.direction === "UP") {
    const previousIndex = previousHeadingSiblingIndex(items, currentIndex, heading);
    if (previousIndex < 0) throw new Error("QUOTE_HEADING_MOVE_BLOCKED");
    reordered = [
      ...items.slice(0, previousIndex),
      ...items.slice(currentIndex, currentEnd),
      ...items.slice(previousIndex, currentIndex),
      ...items.slice(currentEnd),
    ];
  } else {
    const nextIndex = currentEnd;
    const nextHeading = items[nextIndex];
    const isSibling =
      heading.kind === "SECTION"
        ? nextHeading?.kind === "SECTION"
        : nextHeading?.kind === "SUBSECTION" && nextHeading.parentId === heading.parentId;
    if (!isSibling || !nextHeading) throw new Error("QUOTE_HEADING_MOVE_BLOCKED");
    const nextEnd = headingBlockEnd(items, nextIndex);
    reordered = [
      ...items.slice(0, currentIndex),
      ...items.slice(nextIndex, nextEnd),
      ...items.slice(currentIndex, currentEnd),
      ...items.slice(nextEnd),
    ];
  }

  const timestamp = now.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    model: parseQuoteModel({ ...quote.model, items: reordered }),
    updatedAt: timestamp,
    updatedByName: actor.displayName,
  });
  payload.quotes[quoteIndex] = updated;
  return { payload, focusQuoteId: updated.id };
}

function upsertDraftHeading(
  payload: NativeQuotesPayload,
  input: Extract<QuotesMutation, { action: "upsertSection" | "upsertSubsection" }>,
  actor: QuotesActor,
  now: Date,
): QuotesMutationResult {
  const { quoteIndex, quote } = findDraftQuote(payload, input.quoteId);
  const existingIndex = input.itemId
    ? quote.model.items.findIndex((item) => item.id === input.itemId)
    : -1;

  if (input.itemId && existingIndex < 0) throw new Error("QUOTE_HEADING_NOT_FOUND");
  if (existingIndex >= 0) {
    const existing = quote.model.items[existingIndex];
    const expectedKind = input.action === "upsertSection" ? "SECTION" : "SUBSECTION";
    if (existing.kind !== expectedKind) throw new Error("QUOTE_HEADING_NOT_FOUND");
  }

  if (input.action === "upsertSection") {
    return saveDraftItem(
      payload,
      quoteIndex,
      {
        id: input.itemId ?? globalThis.crypto.randomUUID(),
        kind: "SECTION",
        parentId: null,
        title: input.title,
      },
      existingIndex,
      actor,
      now,
    );
  }

  const parent = quote.model.items.find((item) => item.id === input.parentId);
  if (!parent || parent.kind !== "SECTION") throw new Error("QUOTE_SECTION_NOT_FOUND");

  return saveDraftItem(
    payload,
    quoteIndex,
    {
      id: input.itemId ?? globalThis.crypto.randomUUID(),
      kind: "SUBSECTION",
      parentId: input.parentId,
      title: input.title,
    },
    existingIndex,
    actor,
    now,
  );
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
  libraryComponentSources?: ReadonlyMap<string, QuoteLibraryComponentSource>,
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
    const selectedLibrarySource = componentInput.libraryComponentId
      ? libraryComponentSources?.get(componentInput.libraryComponentId)
      : undefined;
    if (componentInput.libraryComponentId && !selectedLibrarySource) {
      throw new Error("QUOTE_LIBRARY_COMPONENT_NOT_FOUND");
    }

    const preservedCost =
      existingComponent?.costPriceCents ??
      existingComponent?.librarySource?.component.costPriceCents ??
      selectedLibrarySource?.component.costPriceCents;
    const costPriceCents = componentInput.costPriceCents ?? preservedCost;
    const librarySource = selectedLibrarySource ?? existingComponent?.librarySource;

    return {
      id: componentInput.id ?? globalThis.crypto.randomUUID(),
      description: componentInput.description,
      unit: componentInput.unit,
      quantity: parsedComponentQuantity.quantity,
      quantityFormula: parsedComponentQuantity.formula,
      ...(costPriceCents !== undefined ? { costPriceCents } : {}),
      unitPriceCents: componentInput.unitPriceCents,
      ...(librarySource ? { librarySource } : {}),
    };
  });

  const automaticUnitPriceCents = calculateQuoteOuvrageUnitPriceCents(components);
  const forcedUnitPriceCents =
    input.forcedUnitPriceCents === undefined
      ? existingLine?.forcedUnitPriceCents
      : (input.forcedUnitPriceCents ?? undefined);

  const line: QuoteLine = {
    id: input.lineId ?? globalThis.crypto.randomUUID(),
    kind: "LINE",
    parentId: input.parentId === undefined ? (existingLine?.parentId ?? null) : input.parentId,
    description: input.description,
    unit: input.unit,
    quantity: parsedQuantity.quantity,
    quantityFormula: parsedQuantity.formula,
    unitPriceCents: forcedUnitPriceCents ?? automaticUnitPriceCents,
    ...(forcedUnitPriceCents !== undefined ? { forcedUnitPriceCents } : {}),
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
  libraryComponentSources?: ReadonlyMap<string, QuoteLibraryComponentSource>,
): QuotesMutationResult {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  if (input.action === "createDraft") {
    return createDraft(payload, input, actor, clientId, now);
  }
  if (input.action === "upsertSection" || input.action === "upsertSubsection") {
    return upsertDraftHeading(payload, input, actor, now);
  }
  if (input.action === "duplicateLine") {
    return duplicateDraftLine(payload, input, actor, now);
  }
  if (input.action === "moveLine") {
    return moveDraftLine(payload, input, actor, now);
  }
  if (input.action === "moveHeading") {
    return moveDraftHeading(payload, input, actor, now);
  }
  if (input.action === "duplicateHeading") {
    return duplicateDraftHeading(payload, input, actor, now);
  }
  if (input.action === "deleteItem") {
    return deleteDraftItem(payload, input, actor, now);
  }
  if (input.action === "upsertOuvrage") {
    return upsertDraftOuvrage(payload, input, actor, now, libraryComponentSources);
  }
  return upsertDraftLine(payload, input, actor, now, librarySource);
}
