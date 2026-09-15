import { z } from "zod";
import {
  QUOTE_MAX_QUANTITY,
  QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH,
  parseQuoteQuantityInput,
  quoteMoneyCentsSchema,
} from "./domain";

export const quoteDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "QUOTE_DATE_INVALID");

const nullableUuidSchema = z.string().uuid().nullable();

export const quoteLibraryComponentSnapshotSchema = z
  .object({
    sourceComponentId: z.string().uuid(),
    name: z.string().trim().min(1).max(240),
    description: z.string().trim().max(4000),
    unit: z.string().trim().min(1).max(40),
    costPriceCents: quoteMoneyCentsSchema,
    marginPercent: z.number().finite().min(0),
    salePriceCents: quoteMoneyCentsSchema,
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
});

export const quoteSubsectionSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("SUBSECTION"),
  parentId: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
});

export const quoteOuvrageComponentSchema = z.object({
  id: z.string().uuid(),
  description: z.string().trim().min(1).max(4000),
  unit: z.string().trim().max(40),
  quantity: z.number().finite().positive().max(QUOTE_MAX_QUANTITY),
  quantityFormula: z.string().trim().min(1).max(QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH).nullable(),
  unitPriceCents: quoteMoneyCentsSchema,
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
  components: z.array(quoteOuvrageComponentSchema).max(200).optional(),
  librarySource: quoteLibrarySourceSchema.optional(),
});

export const quoteCommentSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("COMMENT"),
  parentId: nullableUuidSchema,
  text: z.string().trim().min(1).max(4000),
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
export type QuoteSection = z.infer<typeof quoteSectionSchema>;
export type QuoteSubsection = z.infer<typeof quoteSubsectionSchema>;
export type QuoteOuvrageComponent = z.infer<typeof quoteOuvrageComponentSchema>;
export type QuoteLine = z.infer<typeof quoteLineSchema>;
export type QuoteComment = z.infer<typeof quoteCommentSchema>;
export type QuoteItem = z.infer<typeof quoteItemSchema>;
export type QuoteModel = z.infer<typeof quoteModelSchema>;

export function validateQuoteItemHierarchy(items: QuoteItem[]): void {
  const byId = new Map<string, QuoteItem>();

  for (const item of items) {
    if (byId.has(item.id)) throw new Error("QUOTE_ITEM_ID_DUPLICATE");
    byId.set(item.id, item);
  }

  for (const item of items) {
    if (item.kind === "SECTION") continue;

    if (item.kind === "SUBSECTION") {
      const parent = byId.get(item.parentId);
      if (!parent) throw new Error("QUOTE_ITEM_PARENT_NOT_FOUND");
      if (parent.kind !== "SECTION") throw new Error("QUOTE_ITEM_PARENT_INVALID");
      continue;
    }

    if (item.parentId === null) continue;
    const parent = byId.get(item.parentId);
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

  let parsed;
  try {
    parsed = parseQuoteQuantityInput(quantityFormula);
  } catch {
    throw new Error(invalidCode);
  }

  if (parsed.formula === null) throw new Error(invalidCode);
  if (Math.abs(parsed.quantity - quantity) > 10 ** -6) {
    throw new Error(mismatchCode);
  }
}

function validateQuoteLineFormula(line: QuoteLine): void {
  validateQuantityFormula(
    line.quantity,
    line.quantityFormula,
    "QUOTE_LINE_FORMULA_INVALID",
    "QUOTE_LINE_FORMULA_MISMATCH",
  );
}

function validateQuoteLineLibrarySource(line: QuoteLine): void {
  if (!line.librarySource) return;
  if (line.unitPriceCents === undefined) {
    throw new Error("QUOTE_LINE_LIBRARY_PRICE_MISSING");
  }

  if (line.librarySource.kind === "OUVRAGE") {
    const lineIds = new Set<string>();
    for (const component of line.librarySource.components) {
      if (lineIds.has(component.sourceLineId)) {
        throw new Error("QUOTE_LINE_LIBRARY_SOURCE_INVALID");
      }
      lineIds.add(component.sourceLineId);
    }
  }
}

export function calculateQuoteOuvrageUnitPriceCents(components: QuoteOuvrageComponent[]): number {
  let total = 0;
  for (const component of components) {
    const componentTotal = Math.round(component.quantity * component.unitPriceCents);
    if (!Number.isSafeInteger(componentTotal) || componentTotal < 0) {
      throw new Error("QUOTE_OUVRAGE_PRICE_INVALID");
    }
    total += componentTotal;
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new Error("QUOTE_OUVRAGE_PRICE_INVALID");
    }
  }
  return total;
}

function validateQuoteOuvrageComponents(line: QuoteLine): void {
  const components = line.components ?? [];
  if (components.length === 0) return;

  const ids = new Set<string>();
  for (const component of components) {
    if (ids.has(component.id)) throw new Error("QUOTE_OUVRAGE_COMPONENT_ID_DUPLICATE");
    ids.add(component.id);
    validateQuantityFormula(
      component.quantity,
      component.quantityFormula,
      "QUOTE_OUVRAGE_COMPONENT_FORMULA_INVALID",
      "QUOTE_OUVRAGE_COMPONENT_FORMULA_MISMATCH",
    );
  }

  if (line.unitPriceCents === undefined) throw new Error("QUOTE_OUVRAGE_PRICE_MISSING");
  const expected = calculateQuoteOuvrageUnitPriceCents(components);
  if (expected !== line.unitPriceCents) throw new Error("QUOTE_OUVRAGE_PRICE_MISMATCH");
}

export function parseQuoteModel(value: unknown): QuoteModel {
  const parsed = quoteModelSchema.safeParse(value);
  if (!parsed.success) throw new Error("QUOTE_MODEL_INVALID");

  validateQuoteItemHierarchy(parsed.data.items);
  for (const item of parsed.data.items) {
    if (item.kind === "LINE") {
      validateQuoteLineFormula(item);
      validateQuoteLineLibrarySource(item);
      validateQuoteOuvrageComponents(item);
    }
  }

  return parsed.data;
}
