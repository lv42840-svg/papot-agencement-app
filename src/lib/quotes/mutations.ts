import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  formatQuoteNumber,
  parseQuoteQuantityInput,
  quoteValidityDate,
} from "./domain";
import {
  findQuote,
  quoteClientSnapshotSchema,
  quoteRecordSchema,
  quoteVatRateSchema,
  validateQuoteItemHierarchy,
  type QuoteClientSnapshot,
  type QuoteItem,
  type QuotesPayload,
} from "./model";

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableUuidSchema = z.string().uuid().nullable();
const percentSchema = z.number().finite().min(0).max(100);

const quoteSectionInputSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.literal("SECTION"),
  title: z.string().trim().min(1).max(500),
  discountPercent: percentSchema.default(0),
});

const quoteSubsectionInputSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.literal("SUBSECTION"),
  parentId: z.string().uuid(),
  title: z.string().trim().min(1).max(500),
  discountPercent: percentSchema.default(0),
});

const quoteLineInputSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.literal("LINE"),
  parentId: nullableUuidSchema.default(null),
  description: z.string().trim().min(1).max(4000),
  unit: z.string().trim().max(40).default(""),
  quantityInput: z.string().trim().min(1).max(120),
  unitPriceCents: z.number().int().safe().nonnegative(),
  discountPercent: percentSchema.default(0),
  vatRatePercent: quoteVatRateSchema.default(20),
});

const quoteCommentInputSchema = z.object({
  id: z.string().uuid().optional(),
  kind: z.literal("COMMENT"),
  parentId: nullableUuidSchema.default(null),
  text: z.string().trim().min(1).max(4000),
});

const quoteItemInputSchema = z.discriminatedUnion("kind", [
  quoteSectionInputSchema,
  quoteSubsectionInputSchema,
  quoteLineInputSchema,
  quoteCommentInputSchema,
]);

const createQuoteMutationSchema = z.object({
  action: z.literal("create"),
  quoteId: z.string().uuid().optional(),
  commercialCaseId: nullableUuidSchema.default(null),
  clientId: z.string().uuid(),
  subject: z.string().trim().min(1).max(240),
  issueDate: dateOnlySchema.optional(),
  validityDays: z.number().int().min(1).max(365).default(30),
  paymentTerms: z.string().trim().max(1000).default(""),
  globalDiscountPercent: percentSchema.default(0),
  items: z.array(quoteItemInputSchema).max(1000).default([]),
  notes: z.string().trim().max(4000).default(""),
});

const updateQuoteMutationSchema = z.object({
  action: z.literal("update"),
  quoteId: z.string().uuid(),
  commercialCaseId: nullableUuidSchema.optional(),
  clientId: z.string().uuid().optional(),
  subject: z.string().trim().min(1).max(240).optional(),
  issueDate: dateOnlySchema.optional(),
  validityDays: z.number().int().min(1).max(365).optional(),
  paymentTerms: z.string().trim().max(1000).optional(),
  globalDiscountPercent: percentSchema.optional(),
  items: z.array(quoteItemInputSchema).max(1000).optional(),
  notes: z.string().trim().max(4000).optional(),
});

const sendQuoteMutationSchema = z.object({
  action: z.literal("send"),
  quoteId: z.string().uuid(),
});

export const quotesMutationSchema = z.discriminatedUnion("action", [
  createQuoteMutationSchema,
  updateQuoteMutationSchema,
  sendQuoteMutationSchema,
]);

export type QuotesMutation = z.infer<typeof quotesMutationSchema>;
export type QuotesActor = { userId: string; displayName: string };
export type QuotesMutationResult = { payload: QuotesPayload; focusQuoteId: string };
export type QuoteSendContext = { clientSnapshot: QuoteClientSnapshot };

type QuoteItemInput = z.infer<typeof quoteItemInputSchema>;

function quoteParisDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeItems(input: QuoteItemInput[]): QuoteItem[] {
  const items = input.map((item): QuoteItem => {
    const id = item.id ?? randomUUID();
    if (item.kind === "SECTION") {
      return {
        id,
        kind: "SECTION",
        parentId: null,
        title: item.title,
        discountPercent: item.discountPercent,
      };
    }
    if (item.kind === "SUBSECTION") {
      return {
        id,
        kind: "SUBSECTION",
        parentId: item.parentId,
        title: item.title,
        discountPercent: item.discountPercent,
      };
    }
    if (item.kind === "COMMENT") {
      return { id, kind: "COMMENT", parentId: item.parentId, text: item.text };
    }

    const quantity = parseQuoteQuantityInput(item.quantityInput);
    return {
      id,
      kind: "LINE",
      parentId: item.parentId,
      description: item.description,
      unit: item.unit,
      quantity: quantity.quantity,
      quantityFormula: quantity.formula,
      unitPriceCents: item.unitPriceCents,
      discountPercent: item.discountPercent,
      vatRatePercent: item.vatRatePercent,
    };
  });

  validateQuoteItemHierarchy(items);
  return items;
}

function nextQuoteSequence(payload: QuotesPayload, year: number): number {
  const stored = payload.sequenceByYear[String(year)] ?? 0;
  const existing = payload.quotes.reduce((maximum, quote) => {
    if (quote.numberYear !== year || quote.numberSequence === null) return maximum;
    return Math.max(maximum, quote.numberSequence);
  }, 0);
  const next = Math.max(stored, existing) + 1;
  if (next > 9999) throw new Error("QUOTE_SEQUENCE_EXHAUSTED");
  return next;
}

function parseRecord(value: unknown) {
  const parsed = quoteRecordSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues.find((item) => item.code === "custom");
  if (issue?.message) throw new Error(issue.message);
  throw new Error("QUOTE_RECORD_INVALID");
}

export function applyQuotesMutation(
  source: QuotesPayload,
  input: QuotesMutation,
  actor: QuotesActor,
  nowDate: Date = new Date(),
  sendContext?: QuoteSendContext,
): QuotesMutationResult {
  const payload = structuredClone(source);
  const now = nowDate.toISOString();

  if (input.action === "create") {
    const id = input.quoteId ?? randomUUID();
    if (payload.quotes.some((quote) => quote.id === id)) {
      return { payload, focusQuoteId: id };
    }

    const issueDate = input.issueDate ?? quoteParisDateKey(nowDate);
    const quote = parseRecord({
      id,
      commercialCaseId: input.commercialCaseId,
      clientId: input.clientId,
      clientSnapshot: null,
      subject: input.subject,
      status: "DRAFT",
      version: 1,
      quoteNumber: null,
      numberYear: null,
      numberSequence: null,
      issueDate,
      validityDays: input.validityDays,
      validUntil: quoteValidityDate(issueDate, input.validityDays),
      paymentTerms: input.paymentTerms,
      globalDiscountPercent: input.globalDiscountPercent,
      items: normalizeItems(input.items),
      notes: input.notes,
      createdAt: now,
      createdByName: actor.displayName,
      updatedAt: now,
      updatedByName: actor.displayName,
      sentAt: null,
      sentByName: null,
    });
    payload.quotes.unshift(quote);
    return { payload, focusQuoteId: quote.id };
  }

  const quote = findQuote(payload, input.quoteId);

  if (input.action === "update") {
    if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_DRAFT");
    const issueDate = input.issueDate ?? quote.issueDate;
    const validityDays = input.validityDays ?? quote.validityDays;
    const updated = parseRecord({
      ...quote,
      commercialCaseId:
        input.commercialCaseId === undefined ? quote.commercialCaseId : input.commercialCaseId,
      clientId: input.clientId ?? quote.clientId,
      subject: input.subject ?? quote.subject,
      issueDate,
      validityDays,
      validUntil: quoteValidityDate(issueDate, validityDays),
      paymentTerms: input.paymentTerms ?? quote.paymentTerms,
      globalDiscountPercent: input.globalDiscountPercent ?? quote.globalDiscountPercent,
      items: input.items ? normalizeItems(input.items) : quote.items,
      notes: input.notes ?? quote.notes,
      updatedAt: now,
      updatedByName: actor.displayName,
    });
    const index = payload.quotes.findIndex((candidate) => candidate.id === quote.id);
    payload.quotes[index] = updated;
    return { payload, focusQuoteId: updated.id };
  }

  if (quote.status === "SENT") {
    return { payload, focusQuoteId: quote.id };
  }
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_DRAFT");
  if (!quote.items.some((item) => item.kind === "LINE")) {
    throw new Error("QUOTE_EMPTY");
  }
  if (!quote.paymentTerms.trim()) throw new Error("QUOTE_PAYMENT_TERMS_REQUIRED");
  if (!sendContext) throw new Error("QUOTE_SEND_CONTEXT_REQUIRED");

  const clientSnapshot = quoteClientSnapshotSchema.parse({
    ...sendContext.clientSnapshot,
    paymentTerms: quote.paymentTerms,
  });
  const year = Number(quote.issueDate.slice(0, 4));
  const sequence = nextQuoteSequence(payload, year);
  const sent = parseRecord({
    ...quote,
    clientSnapshot,
    status: "SENT",
    quoteNumber: formatQuoteNumber(year, sequence),
    numberYear: year,
    numberSequence: sequence,
    updatedAt: now,
    updatedByName: actor.displayName,
    sentAt: now,
    sentByName: actor.displayName,
  });
  payload.sequenceByYear[String(year)] = sequence;
  const index = payload.quotes.findIndex((candidate) => candidate.id === quote.id);
  payload.quotes[index] = sent;
  return { payload, focusQuoteId: sent.id };
}
