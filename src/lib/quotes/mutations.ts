import { z } from "zod";
import { productionActivitySchema } from "../production-activity";
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
  quoteItemTextStyleSchema,
  type QuoteItem,
  type QuoteLibraryComponentSource,
  type QuoteLine,
  type QuoteOuvrageComponent,
  type QuoteSection,
  type QuoteSubsection,
} from "./model";
import { reorderQuoteItems } from "./item-reorder";
import {
  nativeQuoteRecordSchema,
  parseNativeQuotesPayload,
  type NativeQuotesPayload,
} from "./store";

const createDraftMutationSchema = z.object({
  action: z.literal("createDraft"),
  commercialCaseId: z.string().uuid(),
  quoteKind: z.enum(["STANDARD", "TS"]).default("STANDARD"),
  subject: z.string().trim().min(1).max(240),
  issueDate: quoteDateSchema,
  variantName: z.string().trim().min(1).max(120).default("Base"),
  paymentTerms: z.string().trim().min(1).max(1000),
});

const deleteDraftMutationSchema = z.object({
  action: z.literal("deleteDraft"),
  quoteId: z.string().uuid(),
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
  activity: productionActivitySchema.optional(),
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

const reorderItemMutationSchema = z.object({
  action: z.literal("reorderItem"),
  quoteId: z.string().uuid(),
  itemId: z.string().uuid(),
  targetId: z.string().uuid(),
  placement: z.enum(["BEFORE", "AFTER", "INSIDE"]),
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

const updateItemPresentationMutationSchema = z.object({
  action: z.literal("updateItemPresentation"),
  quoteId: z.string().uuid(),
  itemId: z.string().uuid(),
  textStyle: quoteItemTextStyleSchema.nullable(),
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
  deleteDraftMutationSchema,
  upsertLineMutationSchema,
  upsertOuvrageMutationSchema,
  duplicateLineMutationSchema,
  moveLineMutationSchema,
  reorderItemMutationSchema,
  moveHeadingMutationSchema,
  duplicateHeadingMutationSchema,
  deleteItemMutationSchema,
  updateItemPresentationMutationSchema,
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

function sameVariant(gauche: string, droite: string): boolean {
  return gauche.localeCompare(droite, "fr-FR", { sensitivity: "base" }) === 0;
}

function nextVariantVersion(
  contenu: NativeQuotesPayload,
  commercialCaseId: string,
  variantName: string,
): number {
  return (
    contenu.quotes.reduce((highest, quote) => {
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
  contenu: NativeQuotesPayload,
  saisie: Extract<QuotesMutation, { action: "createDraft" }>,
  auteur: QuotesActor,
  idClient: string | undefined,
  maintenant: Date,
): QuotesMutationResult {
  if (!idClient) throw new Error("QUOTE_CLIENT_NOT_FOUND");

  const idDevis = globalThis.crypto.randomUUID();
  const timestamp = maintenant.toISOString();
  const version = nextVariantVersion(contenu, saisie.commercialCaseId, saisie.variantName);
  const model = parseQuoteModel({
    id: idDevis,
    clientId: idClient,
    subject: saisie.subject,
    issueDate: saisie.issueDate,
    validityDays: QUOTE_DEFAULT_VALIDITY_DAYS,
    paymentTerms: saisie.paymentTerms,
    items: [],
  });

  const enregistrement = nativeQuoteRecordSchema.parse({
    id: idDevis,
    commercialCaseId: saisie.commercialCaseId,
    quoteKind: saisie.quoteKind,
    variantName: saisie.variantName,
    version,
    status: "DRAFT",
    model,
    createdAt: timestamp,
    createdByName: auteur.displayName,
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });

  contenu.quotes.push(enregistrement);
  return { payload: contenu, focusQuoteId: idDevis };
}

function findDraftQuote(contenu: NativeQuotesPayload, idDevis: string) {
  const quoteIndex = contenu.quotes.findIndex((quote) => quote.id === idDevis);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");

  const quote = contenu.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");
  return { quoteIndex, quote };
}

function findDraftLine(contenu: NativeQuotesPayload, idDevis: string, lineId?: string) {
  const { quoteIndex, quote } = findDraftQuote(contenu, idDevis);

  let existingLine: QuoteLine | undefined;
  let existingIndex = -1;
  if (lineId) {
    existingIndex = quote.model.items.findIndex((element) => element.id === lineId);
    if (existingIndex < 0 || quote.model.items[existingIndex].kind !== "LINE") {
      throw new Error("QUOTE_LINE_NOT_FOUND");
    }
    existingLine = quote.model.items[existingIndex] as QuoteLine;
  }

  return { quoteIndex, quote, existingLine, existingIndex };
}

function saveDraftItem(
  contenu: NativeQuotesPayload,
  quoteIndex: number,
  element: QuoteItem,
  existingIndex: number,
  auteur: QuotesActor,
  maintenant: Date,
): QuotesMutationResult {
  const quote = contenu.quotes[quoteIndex];
  const elements = [...quote.model.items];
  if (existingIndex >= 0) elements[existingIndex] = element;
  else elements.push(element);

  const timestamp = maintenant.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    model: parseQuoteModel({ ...quote.model, items: elements }),
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });
  contenu.quotes[quoteIndex] = updated;
  return { payload: contenu, focusQuoteId: updated.id };
}

function saveDraftLine(
  contenu: NativeQuotesPayload,
  quoteIndex: number,
  ligne: QuoteLine,
  existingIndex: number,
  auteur: QuotesActor,
  maintenant: Date,
): QuotesMutationResult {
  return saveDraftItem(contenu, quoteIndex, ligne, existingIndex, auteur, maintenant);
}

function clonePresentationForDuplicate(
  presentation: QuoteItem["presentation"],
): QuoteItem["presentation"] {
  if (!presentation?.textStyle) return undefined;
  return { textStyle: structuredClone(presentation.textStyle), photos: [] };
}

function duplicateDraftLine(
  contenu: NativeQuotesPayload,
  saisie: Extract<QuotesMutation, { action: "duplicateLine" }>,
  auteur: QuotesActor,
  maintenant: Date,
): QuotesMutationResult {
  const { quoteIndex, quote, existingLine, existingIndex } = findDraftLine(
    contenu,
    saisie.quoteId,
    saisie.lineId,
  );
  if (!existingLine || existingIndex < 0) throw new Error("QUOTE_LINE_NOT_FOUND");

  const duplicatedLine: QuoteLine = {
    ...structuredClone(existingLine),
    id: globalThis.crypto.randomUUID(),
    presentation: clonePresentationForDuplicate(existingLine.presentation),
    components: (existingLine.components ?? []).map((component) => ({
      ...structuredClone(component),
      id: globalThis.crypto.randomUUID(),
    })),
  };

  const elements = [...quote.model.items];
  elements.splice(existingIndex + 1, 0, duplicatedLine);
  const timestamp = maintenant.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    model: parseQuoteModel({ ...quote.model, items: elements }),
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });
  contenu.quotes[quoteIndex] = updated;
  return { payload: contenu, focusQuoteId: updated.id };
}

function moveDraftLine(
  contenu: NativeQuotesPayload,
  saisie: Extract<QuotesMutation, { action: "moveLine" }>,
  auteur: QuotesActor,
  maintenant: Date,
): QuotesMutationResult {
  const { quoteIndex, quote, existingLine, existingIndex } = findDraftLine(
    contenu,
    saisie.quoteId,
    saisie.lineId,
  );
  if (!existingLine || existingIndex < 0) throw new Error("QUOTE_LINE_NOT_FOUND");

  const targetIndex = saisie.direction === "UP" ? existingIndex - 1 : existingIndex + 1;
  const cible = quote.model.items[targetIndex];
  if (!cible || cible.kind !== "LINE" || cible.parentId !== existingLine.parentId) {
    throw new Error("QUOTE_LINE_MOVE_BLOCKED");
  }

  const elements = [...quote.model.items];
  [elements[existingIndex], elements[targetIndex]] = [
    elements[targetIndex],
    elements[existingIndex],
  ];
  const timestamp = maintenant.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    model: parseQuoteModel({ ...quote.model, items: elements }),
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });
  contenu.quotes[quoteIndex] = updated;
  return { payload: contenu, focusQuoteId: updated.id };
}

function reorderDraftItem(
  contenu: NativeQuotesPayload,
  saisie: Extract<QuotesMutation, { action: "reorderItem" }>,
  auteur: QuotesActor,
  maintenant: Date,
): QuotesMutationResult {
  const { quoteIndex, quote } = findDraftQuote(contenu, saisie.quoteId);
  const elements = reorderQuoteItems(
    quote.model.items,
    saisie.itemId,
    saisie.targetId,
    saisie.placement,
  );
  const timestamp = maintenant.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    model: parseQuoteModel({ ...quote.model, items: elements }),
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });
  contenu.quotes[quoteIndex] = updated;
  return { payload: contenu, focusQuoteId: updated.id };
}

function headingBlockEnd(elements: QuoteItem[], startIndex: number): number {
  const heading = elements[startIndex];
  if (!heading || (heading.kind !== "SECTION" && heading.kind !== "SUBSECTION")) {
    return startIndex + 1;
  }

  for (let indice = startIndex + 1; indice < elements.length; indice += 1) {
    const candidat = elements[indice];
    if (candidat.kind === "SECTION") return indice;
    if (
      heading.kind === "SUBSECTION" &&
      candidat.kind === "SUBSECTION" &&
      candidat.parentId === heading.parentId
    ) {
      return indice;
    }
  }
  return elements.length;
}

function deleteDraftItem(
  contenu: NativeQuotesPayload,
  saisie: Extract<QuotesMutation, { action: "deleteItem" }>,
  auteur: QuotesActor,
  maintenant: Date,
): QuotesMutationResult {
  const { quoteIndex, quote } = findDraftQuote(contenu, saisie.quoteId);
  const itemIndex = quote.model.items.findIndex((element) => element.id === saisie.itemId);
  if (itemIndex < 0) throw new Error("QUOTE_ITEM_NOT_FOUND");

  const element = quote.model.items[itemIndex];
  if (element.kind === "COMMENT") throw new Error("QUOTE_ITEM_DELETE_UNSUPPORTED");

  const deleteEnd =
    element.kind === "SECTION" || element.kind === "SUBSECTION"
      ? headingBlockEnd(quote.model.items, itemIndex)
      : itemIndex + 1;
  const elements = [
    ...quote.model.items.slice(0, itemIndex),
    ...quote.model.items.slice(deleteEnd),
  ];
  const timestamp = maintenant.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    model: parseQuoteModel({ ...quote.model, items: elements }),
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });
  contenu.quotes[quoteIndex] = updated;
  return { payload: contenu, focusQuoteId: updated.id };
}

function previousHeadingSiblingIndex(
  elements: QuoteItem[],
  currentIndex: number,
  heading: QuoteSection | QuoteSubsection,
): number {
  for (let indice = currentIndex - 1; indice >= 0; indice -= 1) {
    const candidat = elements[indice];
    if (heading.kind === "SECTION") {
      if (candidat.kind === "SECTION") return indice;
      continue;
    }
    if (candidat.kind === "SECTION") return -1;
    if (candidat.kind === "SUBSECTION" && candidat.parentId === heading.parentId) return indice;
  }
  return -1;
}

function duplicateDraftHeading(
  contenu: NativeQuotesPayload,
  saisie: Extract<QuotesMutation, { action: "duplicateHeading" }>,
  auteur: QuotesActor,
  maintenant: Date,
): QuotesMutationResult {
  const { quoteIndex, quote } = findDraftQuote(contenu, saisie.quoteId);
  const currentIndex = quote.model.items.findIndex((element) => element.id === saisie.itemId);
  if (currentIndex < 0) throw new Error("QUOTE_HEADING_NOT_FOUND");

  const heading = quote.model.items[currentIndex];
  if (heading.kind !== "SECTION" && heading.kind !== "SUBSECTION") {
    throw new Error("QUOTE_HEADING_NOT_FOUND");
  }

  const currentEnd = headingBlockEnd(quote.model.items, currentIndex);
  const sourceBlock = quote.model.items.slice(currentIndex, currentEnd);
  const newIds = new Map(
    sourceBlock.map((element) => [element.id, globalThis.crypto.randomUUID()]),
  );
  const duplicatedBlock: QuoteItem[] = sourceBlock.map((element) => {
    const id = newIds.get(element.id);
    if (!id) throw new Error("QUOTE_HEADING_DUPLICATION_FAILED");

    if (element.kind === "SECTION") {
      return {
        ...structuredClone(element),
        id,
        presentation: clonePresentationForDuplicate(element.presentation),
      };
    }

    if (element.kind === "SUBSECTION") {
      return {
        ...structuredClone(element),
        id,
        parentId: newIds.get(element.parentId) ?? element.parentId,
        presentation: clonePresentationForDuplicate(element.presentation),
      };
    }

    const parentId =
      element.parentId === null ? null : (newIds.get(element.parentId) ?? element.parentId);
    if (element.kind === "LINE") {
      return {
        ...structuredClone(element),
        id,
        parentId,
        presentation: clonePresentationForDuplicate(element.presentation),
        components: element.components?.map((component) => ({
          ...structuredClone(component),
          id: globalThis.crypto.randomUUID(),
        })),
      };
    }

    return {
      ...structuredClone(element),
      id,
      parentId,
      presentation: clonePresentationForDuplicate(element.presentation),
    };
  });

  const elements = [
    ...quote.model.items.slice(0, currentEnd),
    ...duplicatedBlock,
    ...quote.model.items.slice(currentEnd),
  ];
  const timestamp = maintenant.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    model: parseQuoteModel({ ...quote.model, items: elements }),
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });
  contenu.quotes[quoteIndex] = updated;
  return { payload: contenu, focusQuoteId: updated.id };
}

function moveDraftHeading(
  contenu: NativeQuotesPayload,
  saisie: Extract<QuotesMutation, { action: "moveHeading" }>,
  auteur: QuotesActor,
  maintenant: Date,
): QuotesMutationResult {
  const { quoteIndex, quote } = findDraftQuote(contenu, saisie.quoteId);
  const currentIndex = quote.model.items.findIndex((element) => element.id === saisie.itemId);
  if (currentIndex < 0) throw new Error("QUOTE_HEADING_NOT_FOUND");

  const heading = quote.model.items[currentIndex];
  if (heading.kind !== "SECTION" && heading.kind !== "SUBSECTION") {
    throw new Error("QUOTE_HEADING_NOT_FOUND");
  }

  const elements = [...quote.model.items];
  const currentEnd = headingBlockEnd(elements, currentIndex);
  let reordered: QuoteItem[];

  if (saisie.direction === "UP") {
    const previousIndex = previousHeadingSiblingIndex(elements, currentIndex, heading);
    if (previousIndex < 0) throw new Error("QUOTE_HEADING_MOVE_BLOCKED");
    reordered = [
      ...elements.slice(0, previousIndex),
      ...elements.slice(currentIndex, currentEnd),
      ...elements.slice(previousIndex, currentIndex),
      ...elements.slice(currentEnd),
    ];
  } else {
    const nextIndex = currentEnd;
    const nextHeading = elements[nextIndex];
    const isSibling =
      heading.kind === "SECTION"
        ? nextHeading?.kind === "SECTION"
        : nextHeading?.kind === "SUBSECTION" && nextHeading.parentId === heading.parentId;
    if (!isSibling || !nextHeading) throw new Error("QUOTE_HEADING_MOVE_BLOCKED");
    const nextEnd = headingBlockEnd(elements, nextIndex);
    reordered = [
      ...elements.slice(0, currentIndex),
      ...elements.slice(nextIndex, nextEnd),
      ...elements.slice(currentIndex, currentEnd),
      ...elements.slice(nextEnd),
    ];
  }

  const timestamp = maintenant.toISOString();
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    model: parseQuoteModel({ ...quote.model, items: reordered }),
    updatedAt: timestamp,
    updatedByName: auteur.displayName,
  });
  contenu.quotes[quoteIndex] = updated;
  return { payload: contenu, focusQuoteId: updated.id };
}

function updateDraftItemPresentation(
  contenu: NativeQuotesPayload,
  saisie: Extract<QuotesMutation, { action: "updateItemPresentation" }>,
  auteur: QuotesActor,
  maintenant: Date,
): QuotesMutationResult {
  const { quoteIndex, quote } = findDraftQuote(contenu, saisie.quoteId);
  const itemIndex = quote.model.items.findIndex((element) => element.id === saisie.itemId);
  if (itemIndex < 0) throw new Error("QUOTE_ITEM_NOT_FOUND");

  const element = structuredClone(quote.model.items[itemIndex]);
  const photos = element.presentation?.photos ?? [];
  if (saisie.textStyle === null) {
    if (photos.length > 0) element.presentation = { photos };
    else delete element.presentation;
  } else {
    element.presentation = { textStyle: saisie.textStyle, photos };
  }

  return saveDraftItem(contenu, quoteIndex, element, itemIndex, auteur, maintenant);
}

function upsertDraftHeading(
  contenu: NativeQuotesPayload,
  saisie: Extract<QuotesMutation, { action: "upsertSection" | "upsertSubsection" }>,
  auteur: QuotesActor,
  maintenant: Date,
): QuotesMutationResult {
  const { quoteIndex, quote } = findDraftQuote(contenu, saisie.quoteId);
  const existingIndex = saisie.itemId
    ? quote.model.items.findIndex((element) => element.id === saisie.itemId)
    : -1;

  if (saisie.itemId && existingIndex < 0) throw new Error("QUOTE_HEADING_NOT_FOUND");
  if (existingIndex >= 0) {
    const existing = quote.model.items[existingIndex];
    const expectedKind = saisie.action === "upsertSection" ? "SECTION" : "SUBSECTION";
    if (existing.kind !== expectedKind) throw new Error("QUOTE_HEADING_NOT_FOUND");
  }

  const existingPresentation =
    existingIndex >= 0 ? quote.model.items[existingIndex].presentation : undefined;

  if (saisie.action === "upsertSection") {
    return saveDraftItem(
      contenu,
      quoteIndex,
      {
        id: saisie.itemId ?? globalThis.crypto.randomUUID(),
        kind: "SECTION",
        parentId: null,
        title: saisie.title,
        ...(existingPresentation ? { presentation: existingPresentation } : {}),
      },
      existingIndex,
      auteur,
      maintenant,
    );
  }

  const parent = quote.model.items.find((element) => element.id === saisie.parentId);
  if (!parent || parent.kind !== "SECTION") throw new Error("QUOTE_SECTION_NOT_FOUND");

  return saveDraftItem(
    contenu,
    quoteIndex,
    {
      id: saisie.itemId ?? globalThis.crypto.randomUUID(),
      kind: "SUBSECTION",
      parentId: saisie.parentId,
      title: saisie.title,
      ...(existingPresentation ? { presentation: existingPresentation } : {}),
    },
    existingIndex,
    auteur,
    maintenant,
  );
}

function upsertDraftLine(
  contenu: NativeQuotesPayload,
  saisie: Extract<QuotesMutation, { action: "upsertLine" }>,
  auteur: QuotesActor,
  maintenant: Date,
  librarySource?: QuoteLibraryComponentSource,
): QuotesMutationResult {
  const { quoteIndex, existingLine, existingIndex } = findDraftLine(
    contenu,
    saisie.quoteId,
    saisie.lineId,
  );
  const parsedQuantity = parseQuoteQuantityInput(saisie.quantityInput);

  const ligne: QuoteLine = {
    id: saisie.lineId ?? globalThis.crypto.randomUUID(),
    kind: "LINE",
    parentId: existingLine?.parentId ?? null,
    description: saisie.description,
    unit: saisie.unit,
    quantity: parsedQuantity.quantity,
    quantityFormula: parsedQuantity.formula,
    unitPriceCents: saisie.unitPriceCents,
    components: [],
    ...(existingLine?.presentation ? { presentation: existingLine.presentation } : {}),
    ...(librarySource
      ? { librarySource }
      : existingLine?.librarySource
        ? { librarySource: existingLine.librarySource }
        : {}),
  };

  return saveDraftLine(contenu, quoteIndex, ligne, existingIndex, auteur, maintenant);
}

function upsertDraftOuvrage(
  contenu: NativeQuotesPayload,
  saisie: Extract<QuotesMutation, { action: "upsertOuvrage" }>,
  auteur: QuotesActor,
  maintenant: Date,
  libraryComponentSources?: ReadonlyMap<string, QuoteLibraryComponentSource>,
): QuotesMutationResult {
  const { quoteIndex, existingLine, existingIndex } = findDraftLine(
    contenu,
    saisie.quoteId,
    saisie.lineId,
  );
  const parsedQuantity = parseQuoteQuantityInput(saisie.quantityInput);
  const existingComponents = new Map(
    (existingLine?.components ?? []).map((component) => [component.id, component]),
  );

  const components: QuoteOuvrageComponent[] = saisie.components.map((componentInput) => {
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
    const activity =
      componentInput.activity ??
      existingComponent?.activity ??
      selectedLibrarySource?.component.activity ??
      existingComponent?.librarySource?.component.activity;

    return {
      id: componentInput.id ?? globalThis.crypto.randomUUID(),
      description: componentInput.description,
      unit: componentInput.unit,
      quantity: parsedComponentQuantity.quantity,
      quantityFormula: parsedComponentQuantity.formula,
      ...(costPriceCents !== undefined ? { costPriceCents } : {}),
      unitPriceCents: componentInput.unitPriceCents,
      ...(activity ? { activity } : {}),
      ...(librarySource ? { librarySource } : {}),
    };
  });

  const automaticUnitPriceCents = calculateQuoteOuvrageUnitPriceCents(components);
  const forcedUnitPriceCents =
    saisie.forcedUnitPriceCents === undefined
      ? existingLine?.forcedUnitPriceCents
      : (saisie.forcedUnitPriceCents ?? undefined);

  const ligne: QuoteLine = {
    id: saisie.lineId ?? globalThis.crypto.randomUUID(),
    kind: "LINE",
    parentId: saisie.parentId === undefined ? (existingLine?.parentId ?? null) : saisie.parentId,
    description: saisie.description,
    unit: saisie.unit,
    quantity: parsedQuantity.quantity,
    quantityFormula: parsedQuantity.formula,
    unitPriceCents: forcedUnitPriceCents ?? automaticUnitPriceCents,
    ...(forcedUnitPriceCents !== undefined ? { forcedUnitPriceCents } : {}),
    components,
    ...(existingLine?.presentation ? { presentation: existingLine.presentation } : {}),
    ...(existingLine?.librarySource ? { librarySource: existingLine.librarySource } : {}),
  };

  return saveDraftLine(contenu, quoteIndex, ligne, existingIndex, auteur, maintenant);
}

export function applyQuotesMutation(
  source: NativeQuotesPayload,
  saisie: QuotesMutation,
  auteur: QuotesActor,
  idClient?: string,
  maintenant: Date = new Date(),
  librarySource?: QuoteLibraryComponentSource,
  libraryComponentSources?: ReadonlyMap<string, QuoteLibraryComponentSource>,
): QuotesMutationResult {
  const contenu = structuredClone(parseNativeQuotesPayload(source));
  if (saisie.action === "createDraft") {
    return createDraft(contenu, saisie, auteur, idClient, maintenant);
  }
  if (saisie.action === "deleteDraft") {
    const { quoteIndex } = findDraftQuote(contenu, saisie.quoteId);
    contenu.quotes.splice(quoteIndex, 1);
    // No quote remains selected after deleting a draft, including the last draft.
    return { payload: contenu, focusQuoteId: "" };
  }
  if (saisie.action === "upsertSection" || saisie.action === "upsertSubsection") {
    return upsertDraftHeading(contenu, saisie, auteur, maintenant);
  }
  if (saisie.action === "duplicateLine") {
    return duplicateDraftLine(contenu, saisie, auteur, maintenant);
  }
  if (saisie.action === "moveLine") {
    return moveDraftLine(contenu, saisie, auteur, maintenant);
  }
  if (saisie.action === "reorderItem") {
    return reorderDraftItem(contenu, saisie, auteur, maintenant);
  }
  if (saisie.action === "moveHeading") {
    return moveDraftHeading(contenu, saisie, auteur, maintenant);
  }
  if (saisie.action === "duplicateHeading") {
    return duplicateDraftHeading(contenu, saisie, auteur, maintenant);
  }
  if (saisie.action === "deleteItem") {
    return deleteDraftItem(contenu, saisie, auteur, maintenant);
  }
  if (saisie.action === "updateItemPresentation") {
    return updateDraftItemPresentation(contenu, saisie, auteur, maintenant);
  }
  if (saisie.action === "upsertOuvrage") {
    return upsertDraftOuvrage(contenu, saisie, auteur, maintenant, libraryComponentSources);
  }
  return upsertDraftLine(contenu, saisie, auteur, maintenant, librarySource);
}
