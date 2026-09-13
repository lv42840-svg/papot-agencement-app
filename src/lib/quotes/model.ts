import { z } from "zod";
import {
  quoteMoneyCentsSchema,
  quotePercentSchema,
  quoteStatusSchema,
  quoteVersionSchema,
} from "./domain";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableUuidSchema = z.string().uuid().nullable();

export const quoteVatRateSchema = z.union([
  z.literal(0),
  z.literal(5.5),
  z.literal(10),
  z.literal(20),
]);

export const quoteClientSnapshotSchema = z.object({
  displayName: z.string().trim().min(1).max(240),
  companyName: z.string().trim().max(240),
  firstName: z.string().trim().max(120),
  lastName: z.string().trim().max(120),
  addressLine1: z.string().trim().min(1).max(240),
  addressLine2: z.string().trim().max(240),
  postalCode: z.string().trim().min(1).max(20),
  city: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(80),
  email: z.string().trim().max(240),
  siret: z.string().trim().max(30),
  paymentTerms: z.string().trim().min(1).max(1000),
});

const quoteSectionSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("SECTION"),
  parentId: z.null(),
  title: z.string().trim().min(1).max(500),
  discountPercent: quotePercentSchema,
});

const quoteSubsectionSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("SUBSECTION"),
  parentId: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  discountPercent: quotePercentSchema,
});

const quoteLineSchema = z.object({
  id: z.string().uuid(),
  kind: z.literal("LINE"),
  parentId: nullableUuidSchema,
  description: z.string().trim().min(1).max(4000),
  unit: z.string().trim().max(40),
  quantity: z.number().finite().positive(),
  quantityFormula: z.string().trim().min(1).max(120).nullable(),
  unitPriceCents: quoteMoneyCentsSchema,
  discountPercent: quotePercentSchema,
  vatRatePercent: quoteVatRateSchema,
});

const quoteCommentSchema = z.object({
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

export const quoteRecordSchema = z
  .object({
    id: z.string().uuid(),
    commercialCaseId: nullableUuidSchema,
    clientId: z.string().uuid(),
    clientSnapshot: quoteClientSnapshotSchema.nullable(),
    subject: z.string().trim().min(1).max(240),
    status: quoteStatusSchema,
    version: quoteVersionSchema,
    quoteNumber: z
      .string()
      .regex(/^D-\d{4}-\d{4}$/)
      .nullable(),
    numberYear: z.number().int().min(2000).max(9999).nullable(),
    numberSequence: z.number().int().min(1).max(9999).nullable(),
    issueDate: dateOnlySchema,
    validityDays: z.number().int().min(1).max(365),
    validUntil: dateOnlySchema,
    paymentTerms: z.string().trim().max(1000),
    globalDiscountPercent: quotePercentSchema,
    items: z.array(quoteItemSchema).max(1000),
    notes: z.string().trim().max(4000),
    createdAt: isoDateTimeSchema,
    createdByName: z.string().trim().min(1).max(160),
    updatedAt: isoDateTimeSchema,
    updatedByName: z.string().trim().min(1).max(160),
    sentAt: isoDateTimeSchema.nullable(),
    sentByName: z.string().trim().min(1).max(160).nullable(),
  })
  .superRefine((quote, context) => {
    const numbered = quote.quoteNumber !== null;
    const numberPartsPresent = quote.numberYear !== null && quote.numberSequence !== null;
    if (numbered !== numberPartsPresent) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "QUOTE_NUMBER_STATE_INVALID" });
      return;
    }

    if (numbered) {
      const expected = `D-${quote.numberYear}-${String(quote.numberSequence).padStart(4, "0")}`;
      if (quote.quoteNumber !== expected) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "QUOTE_NUMBER_STATE_INVALID" });
      }
    }

    if (quote.status === "DRAFT") {
      if (
        numbered ||
        quote.sentAt !== null ||
        quote.sentByName !== null ||
        quote.clientSnapshot !== null
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "QUOTE_DRAFT_STATE_INVALID" });
      }
    } else if (
      !numbered ||
      quote.sentAt === null ||
      quote.sentByName === null ||
      quote.clientSnapshot === null
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "QUOTE_FINAL_STATE_INVALID" });
    }
  });

export const quotesPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  sequenceByYear: z.record(z.number().int().nonnegative().max(9999)),
  quotes: z.array(quoteRecordSchema),
});

export type QuoteVatRate = z.infer<typeof quoteVatRateSchema>;
export type QuoteClientSnapshot = z.infer<typeof quoteClientSnapshotSchema>;
export type QuoteItem = z.infer<typeof quoteItemSchema>;
export type QuoteRecord = z.infer<typeof quoteRecordSchema>;
export type QuotesPayload = z.infer<typeof quotesPayloadSchema>;

export function createInitialQuotesPayload(): QuotesPayload {
  return { schemaVersion: 1, sequenceByYear: {}, quotes: [] };
}

export function parseQuotesPayload(value: unknown): QuotesPayload {
  if (value == null) return createInitialQuotesPayload();
  const parsed = quotesPayloadSchema.safeParse(value);
  if (!parsed.success) throw new Error("QUOTES_STORE_INVALID");
  return parsed.data;
}

export function findQuote(payload: QuotesPayload, quoteId: string): QuoteRecord {
  const quote = payload.quotes.find((candidate) => candidate.id === quoteId);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");
  return quote;
}

export function validateQuoteItemHierarchy(items: QuoteItem[]): void {
  const byId = new Map<string, QuoteItem>();
  for (const item of items) {
    if (byId.has(item.id)) throw new Error("QUOTE_ITEM_ID_DUPLICATE");
    byId.set(item.id, item);
  }

  for (const item of items) {
    if (item.kind === "SECTION") continue;
    if (item.parentId === null) continue;
    const parent = byId.get(item.parentId);
    if (!parent) throw new Error("QUOTE_ITEM_PARENT_NOT_FOUND");

    if (item.kind === "SUBSECTION") {
      if (parent.kind !== "SECTION") throw new Error("QUOTE_ITEM_PARENT_INVALID");
      continue;
    }

    if (parent.kind !== "SECTION" && parent.kind !== "SUBSECTION") {
      throw new Error("QUOTE_ITEM_PARENT_INVALID");
    }
  }
}

export function quoteHasBillableLine(quote: QuoteRecord): boolean {
  return quote.items.some((item) => item.kind === "LINE");
}
