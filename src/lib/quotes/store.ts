import { z } from "zod";
import { DEFAULT_VAT_RATE_PERCENT, vatRatePercentSchema } from "../vat";
import { quotePricingConfigSchema } from "./adjustments";
import { QUOTE_DEFAULT_VALIDITY_DAYS, quoteStatusSchema, quoteVersionSchema } from "./domain";
import { quoteModelSchema } from "./model";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const quoteWorkScheduleSchema = z.object({
  startDate: dateOnlySchema.nullable(),
  duration: z.string().trim().max(240),
  endDate: dateOnlySchema.nullable(),
});

export const quoteLineVatOverrideSchema = z.object({
  lineId: z.string().uuid(),
  ratePercent: vatRatePercentSchema,
});

export const quoteTaxConfigSchema = z
  .object({
    defaultRatePercent: vatRatePercentSchema,
    lineOverrides: z.array(quoteLineVatOverrideSchema).max(1000),
  })
  .superRefine((config, context) => {
    const lineIds = new Set<string>();
    for (const override of config.lineOverrides) {
      if (lineIds.has(override.lineId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["lineOverrides"],
          message: "QUOTE_VAT_LINE_OVERRIDE_DUPLICATE",
        });
      }
      lineIds.add(override.lineId);
    }
  });

export const quoteFinalPdfSchema = z.object({
  quoteNumber: z.string().regex(/^D-\d{4}-\d{4}$/),
  variantName: z.string().trim().min(1).max(120),
  version: quoteVersionSchema,
  commercialDocumentId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  storagePath: z.string().trim().min(1).max(1200),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  archivedAt: isoDateTimeSchema,
  archivedByName: z.string().trim().min(1).max(160),
});

export const nativeQuoteRecordSchema = z
  .object({
    id: z.string().uuid(),
    commercialCaseId: z.string().uuid(),
    variantName: z.string().trim().min(1).max(120),
    version: quoteVersionSchema,
    status: quoteStatusSchema,
    sentAt: isoDateTimeSchema.nullable().optional().default(null),
    followUpDate: dateOnlySchema.nullable().optional().default(null),
    finalPdf: quoteFinalPdfSchema.nullable().optional().default(null),
    internalNotes: z.string().trim().max(20_000).optional().default(""),
    pricingConfig: quotePricingConfigSchema.optional().default({
      adjustments: [],
      options: [],
    }),
    workSchedule: quoteWorkScheduleSchema.optional().default({
      startDate: null,
      duration: "",
      endDate: null,
    }),
    taxConfig: quoteTaxConfigSchema.optional().default({
      defaultRatePercent: DEFAULT_VAT_RATE_PERCENT,
      lineOverrides: [],
    }),
    model: quoteModelSchema,
    createdAt: isoDateTimeSchema,
    createdByName: z.string().trim().min(1).max(160),
    updatedAt: isoDateTimeSchema,
    updatedByName: z.string().trim().min(1).max(160),
  })
  .superRefine((record, context) => {
    if (record.id !== record.model.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["model", "id"],
        message: "QUOTE_RECORD_MODEL_ID_MISMATCH",
      });
    }
    if (record.finalPdf) {
      if (record.status === "DRAFT") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["finalPdf"],
          message: "QUOTE_FINAL_PDF_DRAFT_FORBIDDEN",
        });
      }
      if (record.finalPdf.variantName !== record.variantName) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["finalPdf", "variantName"],
          message: "QUOTE_FINAL_PDF_VARIANT_MISMATCH",
        });
      }
      if (record.finalPdf.version !== record.version) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["finalPdf", "version"],
          message: "QUOTE_FINAL_PDF_VERSION_MISMATCH",
        });
      }
    }
  });

export const nativeQuotesPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  quotes: z.array(nativeQuoteRecordSchema),
});

export type QuoteWorkSchedule = z.infer<typeof quoteWorkScheduleSchema>;
export type QuoteLineVatOverride = z.infer<typeof quoteLineVatOverrideSchema>;
export type QuoteTaxConfig = z.infer<typeof quoteTaxConfigSchema>;
export type QuoteFinalPdf = z.infer<typeof quoteFinalPdfSchema>;
export type NativeQuoteRecord = z.infer<typeof nativeQuoteRecordSchema>;
export type NativeQuotesPayload = z.infer<typeof nativeQuotesPayloadSchema>;

export function createInitialNativeQuotesPayload(): NativeQuotesPayload {
  return { schemaVersion: 1, quotes: [] };
}

export function parseNativeQuotesPayload(value: unknown): NativeQuotesPayload {
  if (value == null) return createInitialNativeQuotesPayload();
  const parsed = nativeQuotesPayloadSchema.safeParse(value);
  if (!parsed.success) throw new Error("QUOTES_STORE_INVALID");
  return {
    ...parsed.data,
    quotes: parsed.data.quotes.map((quote) => ({
      ...quote,
      model: {
        ...quote.model,
        validityDays: QUOTE_DEFAULT_VALIDITY_DAYS,
      },
    })),
  };
}
