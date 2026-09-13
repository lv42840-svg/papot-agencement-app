import { z } from "zod";
import {
  QUOTE_MAX_QUANTITY,
  QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH,
  parseQuoteQuantityInput,
} from "./domain";

export const quoteDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    },
    "QUOTE_DATE_INVALID",
  );

const nullableUuidSchema = z.string().uuid().nullable();

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

export const quoteLineSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("LINE"),
  parentId: nullableUuidSchema,
  description: z.string().trim().min(1).max(4000),
  unit: z.string().trim().max(40),
  quantity: z.number().finite().positive().max(QUOTE_MAX_QUANTITY),
  quantityFormula: z
    .string()
    .trim()
    .min(1)
    .max(QUOTE_MAX_QUANTITY_EXPRESSION_LENGTH)
    .nullable(),
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

export type QuoteSection = z.infer<typeof quoteSectionSchema>;
export type QuoteSubsection = z.infer<typeof quoteSubsectionSchema>;
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

function validateQuoteLineFormula(line: QuoteLine): void {
  if (line.quantityFormula === null) return;

  let parsed;
  try {
    parsed = parseQuoteQuantityInput(line.quantityFormula);
  } catch {
    throw new Error("QUOTE_LINE_FORMULA_INVALID");
  }

  if (parsed.formula === null) throw new Error("QUOTE_LINE_FORMULA_INVALID");
  if (Math.abs(parsed.quantity - line.quantity) > 10 ** -6) {
    throw new Error("QUOTE_LINE_FORMULA_MISMATCH");
  }
}

export function parseQuoteModel(value: unknown): QuoteModel {
  const parsed = quoteModelSchema.safeParse(value);
  if (!parsed.success) throw new Error("QUOTE_MODEL_INVALID");

  validateQuoteItemHierarchy(parsed.data.items);
  for (const item of parsed.data.items) {
    if (item.kind === "LINE") validateQuoteLineFormula(item);
  }

  return parsed.data;
}
