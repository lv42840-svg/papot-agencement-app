import { z } from "zod";
import { productionActivitySchema } from "../production-activity";
import {
  QUOTE_MAX_QUANTITY,
  QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH,
  parseQuoteQuantityInput,
  quoteMoneyCentsSchema,
} from "./domain";

export const quoteDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((valeur) => {
    const date = new Date(`${valeur}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === valeur;
  }, "QUOTE_DATE_INVALID");

const nullableUuidSchema = z.string().uuid().nullable();

const quoteHexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const quoteItemTextColorMarkSchema = z
  .object({
    start: z.number().int().min(0).max(4000),
    end: z.number().int().min(1).max(4000),
    color: quoteHexColorSchema,
  })
  .strict()
  .refine((mark) => mark.end > mark.start, "QUOTE_TEXT_COLOR_MARK_INVALID");

export const quoteRichTextRunStyleSchema = z
  .object({
    bold: z.boolean(),
    italic: z.boolean(),
    underline: z.boolean(),
    textColor: quoteHexColorSchema.nullable(),
    highlightColor: quoteHexColorSchema.nullable(),
    fontSizePx: z.number().int().min(10).max(40).nullable(),
  })
  .strict();

export const quoteRichTextRunSchema = z
  .object({
    text: z.string().min(1).max(4000),
    style: quoteRichTextRunStyleSchema,
  })
  .strict();

export const quoteRichTextSchema = z
  .object({
    runs: z.array(quoteRichTextRunSchema).max(500),
  })
  .strict()
  .refine(
    (richText) => richText.runs.reduce((length, run) => length + run.text.length, 0) <= 4000,
    "QUOTE_RICH_TEXT_TOO_LONG",
  );

export const quoteItemFontFamilySchema = z.enum([
  "DEFAULT",
  "ARIAL",
  "CALIBRI",
  "GEORGIA",
  "TIMES_NEW_ROMAN",
  "VERDANA",
]);
export const quoteItemTextStyleSchema = z
  .object({
    fontFamily: quoteItemFontFamilySchema,
    fontSizePx: z.number().int().min(10).max(40),
    textColor: quoteHexColorSchema,
    highlightColor: quoteHexColorSchema.nullable(),
    bold: z.boolean(),
    italic: z.boolean(),
    textColorMarks: z.array(quoteItemTextColorMarkSchema).max(500).optional(),
  })
  .strict();

export const quoteItemPhotoSchema = z
  .object({
    id: z.string().uuid(),
    fileName: z.string().trim().min(1).max(240),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(15 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    storagePath: z.string().trim().min(1).max(1200),
    clientVisible: z.boolean(),
    uploadedAt: z.string().datetime({ offset: true }),
    uploadedByName: z.string().trim().min(1).max(160),
  })
  .strict();

export const quoteItemPresentationSchema = z
  .object({
    textStyle: quoteItemTextStyleSchema.optional(),
    richText: quoteRichTextSchema.optional(),
    photos: z.array(quoteItemPhotoSchema).max(20).optional().default([]),
  })
  .strict();

export const quoteLibraryComponentSnapshotSchema = z
  .object({
    sourceComponentId: z.string().uuid(),
    name: z.string().trim().min(1).max(240),
    description: z.string().trim().max(4000),
    unit: z.string().trim().min(1).max(40),
    costPriceCents: quoteMoneyCentsSchema,
    marginPercent: z.number().finite().min(0),
    salePriceCents: quoteMoneyCentsSchema,
    activity: productionActivitySchema.optional(),
  })
  .strict();

export const quoteLibraryComponentSourceSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("COMPONENT"),
    component: quoteLibraryComponentSnapshotSchema,
  })
  .strict();

export const quoteLibraryOuvrageComponentSnapshotSchema = z
  .object({
    sourceLineId: z.string().uuid(),
    quantity: z.number().finite().positive(),
    component: quoteLibraryComponentSnapshotSchema,
  })
  .strict();

export const quoteLibraryOuvrageSourceSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("OUVRAGE"),
    sourceOuvrageId: z.string().uuid(),
    name: z.string().trim().min(1).max(240),
    description: z.string().trim().max(4000),
    costPriceCents: quoteMoneyCentsSchema,
    salePriceCents: quoteMoneyCentsSchema,
    components: z.array(quoteLibraryOuvrageComponentSnapshotSchema).min(1),
  })
  .strict();

export const quoteLibrarySourceSchema = z.discriminatedUnion("kind", [
  quoteLibraryComponentSourceSchema,
  quoteLibraryOuvrageSourceSchema,
]);

export const quoteSectionSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("SECTION"),
  parentId: z.null(),
  title: z.string().trim().min(1).max(500),
  presentation: quoteItemPresentationSchema.optional(),
});

export const quoteSubsectionSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("SUBSECTION"),
  parentId: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  presentation: quoteItemPresentationSchema.optional(),
});

export const quoteOuvrageComponentSchema = z.object({
  id: z.string().uuid(),
  description: z.string().trim().min(1).max(4000),
  unit: z.string().trim().max(40),
  quantity: z.number().finite().positive().max(QUOTE_MAX_QUANTITY),
  quantityFormula: z.string().trim().min(1).max(QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH).nullable(),
  costPriceCents: quoteMoneyCentsSchema.optional(),
  unitPriceCents: quoteMoneyCentsSchema,
  activity: productionActivitySchema.optional(),
  librarySource: quoteLibraryComponentSourceSchema.optional(),
});

export const quoteLineSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("LINE"),
  parentId: nullableUuidSchema,
  description: z.string().trim().min(1).max(4000),
  unit: z.string().trim().max(40),
  quantity: z.number().finite().positive().max(QUOTE_MAX_QUANTITY),
  quantityFormula: z.string().trim().min(1).max(QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH).nullable(),
  unitPriceCents: quoteMoneyCentsSchema.optional(),
  forcedUnitPriceCents: quoteMoneyCentsSchema.optional(),
  components: z.array(quoteOuvrageComponentSchema).max(200).optional(),
  librarySource: quoteLibrarySourceSchema.optional(),
  presentation: quoteItemPresentationSchema.optional(),
});

export const quoteCommentSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("COMMENT"),
  parentId: nullableUuidSchema,
  text: z.string().trim().min(1).max(4000),
  presentation: quoteItemPresentationSchema.optional(),
});

export const quoteItemSchema = z.discriminatedUnion("kind", [
  quoteSectionSchema,
  quoteSubsectionSchema,
  quoteLineSchema,
  quoteCommentSchema,
]);

export const quoteModelSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  subject: z.string().trim().min(1).max(240),
  issueDate: quoteDateSchema,
  validityDays: z.number().int().min(1).max(365),
  paymentTerms: z.string().trim().min(1).max(1000),
  items: z.array(quoteItemSchema).max(1000),
});

export type QuoteLibraryComponentSnapshot = z.infer<typeof quoteLibraryComponentSnapshotSchema>;
export type QuoteLibraryComponentSource = z.infer<typeof quoteLibraryComponentSourceSchema>;
export type QuoteLibraryOuvrageComponentSnapshot = z.infer<
  typeof quoteLibraryOuvrageComponentSnapshotSchema
>;
export type QuoteLibraryOuvrageSource = z.infer<typeof quoteLibraryOuvrageSourceSchema>;
export type QuoteLibrarySource = z.infer<typeof quoteLibrarySourceSchema>;
export type QuoteItemFontFamily = z.infer<typeof quoteItemFontFamilySchema>;
export type QuoteItemTextStyle = z.infer<typeof quoteItemTextStyleSchema>;
export type QuoteItemTextColorMark = z.infer<typeof quoteItemTextColorMarkSchema>;
export type QuoteRichTextRunStyle = z.infer<typeof quoteRichTextRunStyleSchema>;
export type QuoteRichTextRun = z.infer<typeof quoteRichTextRunSchema>;
export type QuoteRichText = z.infer<typeof quoteRichTextSchema>;
export type QuoteItemPhoto = z.infer<typeof quoteItemPhotoSchema>;
export type QuoteItemPresentation = z.infer<typeof quoteItemPresentationSchema>;
export type QuoteSection = z.infer<typeof quoteSectionSchema>;
export type QuoteSubsection = z.infer<typeof quoteSubsectionSchema>;
export type QuoteOuvrageComponent = z.infer<typeof quoteOuvrageComponentSchema>;
export type QuoteLine = z.infer<typeof quoteLineSchema>;
export type QuoteComment = z.infer<typeof quoteCommentSchema>;
export type QuoteItem = z.infer<typeof quoteItemSchema>;
export type QuoteModel = z.infer<typeof quoteModelSchema>;

export function validateQuoteItemHierarchy(elements: QuoteItem[]): void {
  const parId = new Map<string, QuoteItem>();

  for (const element of elements) {
    if (parId.has(element.id)) throw new Error("QUOTE_ITEM_ID_DUPLICATE");
    parId.set(element.id, element);
  }

  for (const element of elements) {
    if (element.kind === "SECTION") continue;
    if (element.kind === "SUBSECTION") {
      const parent = parId.get(element.parentId);
      if (!parent) throw new Error("QUOTE_ITEM_PARENT_NOT_FOUND");
      if (parent.kind !== "SECTION") throw new Error("QUOTE_ITEM_PARENT_INVALID");
      continue;
    }

    if (element.parentId === null) continue;
    const parent = parId.get(element.parentId);
    if (!parent) throw new Error("QUOTE_ITEM_PARENT_NOT_FOUND");
    if (parent.kind !== "SECTION" && parent.kind !== "SUBSECTION") {
      throw new Error("QUOTE_ITEM_PARENT_INVALID");
    }
  }
}

function validateQuantityFormula(
  quantity: number,
  quantityFormula: string | null,
  invalidCode: string,
  mismatchCode: string,
): void {
  if (quantityFormula === null) return;

  let analyse;
  try {
    analyse = parseQuoteQuantityInput(quantityFormula);
  } catch {
    throw new Error(invalidCode);
  }

  if (analyse.formula === null) throw new Error(invalidCode);
  if (Math.abs(analyse.quantity - quantity) > 10 ** -6) {
    throw new Error(mismatchCode);
  }
}

function validateQuoteLineFormula(ligne: QuoteLine): void {
  validateQuantityFormula(
    ligne.quantity,
    ligne.quantityFormula,
    "QUOTE_LINE_FORMULA_INVALID",
    "QUOTE_LINE_FORMULA_MISMATCH",
  );
}

function validateQuoteLineLibrarySource(ligne: QuoteLine): void {
  if (!ligne.librarySource) return;
  if (ligne.unitPriceCents === undefined) {
    throw new Error("QUOTE_LINE_LIBRARY_PRICE_MISSING");
  }

  if (ligne.librarySource.kind === "OUVRAGE") {
    const lineIds = new Set<string>();
    for (const component of ligne.librarySource.components) {
      if (lineIds.has(component.sourceLineId)) {
        throw new Error("QUOTE_LINE_LIBRARY_SOURCE_INVALID");
      }
      lineIds.add(component.sourceLineId);
    }
  }
}

function addMoneyCents(total: number, montant: number): number {
  const suivant = total + montant;
  if (!Number.isSafeInteger(suivant) || suivant < 0) {
    throw new Error("QUOTE_OUVRAGE_PRICE_INVALID");
  }
  return suivant;
}

function componentAmountCents(quantity: number, unitAmountCents: number): number {
  const montant = Math.round(quantity * unitAmountCents);
  if (!Number.isSafeInteger(montant) || montant < 0) {
    throw new Error("QUOTE_OUVRAGE_PRICE_INVALID");
  }
  return montant;
}

export function calculateQuoteOuvrageUnitPriceCents(components: QuoteOuvrageComponent[]): number {
  let total = 0;
  for (const component of components) {
    total = addMoneyCents(
      total,
      componentAmountCents(component.quantity, component.unitPriceCents),
    );
  }
  return total;
}

export function quoteOuvrageComponentCostPriceCents(
  component: QuoteOuvrageComponent,
): number | null {
  if (component.costPriceCents !== undefined) return component.costPriceCents;
  return component.librarySource?.component.costPriceCents ?? null;
}

export function calculateQuoteOuvrageUnitCostCents(
  components: QuoteOuvrageComponent[],
): number | null {
  if (components.length === 0) return null;

  let total = 0;
  for (const component of components) {
    const unitCost = quoteOuvrageComponentCostPriceCents(component);
    if (unitCost === null) return null;
    total = addMoneyCents(total, componentAmountCents(component.quantity, unitCost));
  }
  return total;
}

export function calculateQuoteOuvrageMarginPercent(
  salePriceCents: number,
  costPriceCents: number | null,
): number | null {
  if (costPriceCents === null) return null;
  if (costPriceCents === 0) return salePriceCents === 0 ? 0 : null;
  return ((salePriceCents - costPriceCents) / costPriceCents) * 100;
}

function validateQuoteOuvrageComponents(ligne: QuoteLine): void {
  const components = ligne.components ?? [];
  if (components.length === 0) return;

  const identifiants = new Set<string>();
  for (const component of components) {
    if (identifiants.has(component.id)) throw new Error("QUOTE_OUVRAGE_COMPONENT_ID_DUPLICATE");
    identifiants.add(component.id);
    validateQuantityFormula(
      component.quantity,
      component.quantityFormula,
      "QUOTE_OUVRAGE_COMPONENT_FORMULA_INVALID",
      "QUOTE_OUVRAGE_COMPONENT_FORMULA_MISMATCH",
    );
  }

  if (ligne.unitPriceCents === undefined) throw new Error("QUOTE_OUVRAGE_PRICE_MISSING");
  const automaticPrice = calculateQuoteOuvrageUnitPriceCents(components);
  const attendu = ligne.forcedUnitPriceCents ?? automaticPrice;
  if (attendu !== ligne.unitPriceCents) throw new Error("QUOTE_OUVRAGE_PRICE_MISMATCH");
}

export function parseQuoteModel(valeur: unknown): QuoteModel {
  const analyse = quoteModelSchema.safeParse(valeur);
  if (!analyse.success) throw new Error("QUOTE_MODEL_INVALID");

  validateQuoteItemHierarchy(analyse.data.items);
  for (const element of analyse.data.items) {
    if (element.kind === "LINE") {
      validateQuoteLineFormula(element);
      validateQuoteLineLibrarySource(element);
      validateQuoteOuvrageComponents(element);
    }
  }

  return analyse.data;
}
