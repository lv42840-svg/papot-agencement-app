import { z } from "zod";
import { quoteStatusSchema, quoteVersionSchema } from "./domain";
import { quoteModelSchema } from "./model";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const nativeQuoteRecordSchema = z
  .object({
    id: z.string().uuid(),
    commercialCaseId: z.string().uuid(),
    variantName: z.string().trim().min(1).max(120),
    version: quoteVersionSchema,
    status: quoteStatusSchema,
    sentAt: isoDateTimeSchema.nullable().optional().default(null),
    followUpDate: dateOnlySchema.nullable().optional().default(null),
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
  });

export const nativeQuotesPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  quotes: z.array(nativeQuoteRecordSchema),
});

export type NativeQuoteRecord = z.infer<typeof nativeQuoteRecordSchema>;
export type NativeQuotesPayload = z.infer<typeof nativeQuotesPayloadSchema>;

export function createInitialNativeQuotesPayload(): NativeQuotesPayload {
  return { schemaVersion: 1, quotes: [] };
}

export function parseNativeQuotesPayload(value: unknown): NativeQuotesPayload {
  if (value == null) return createInitialNativeQuotesPayload();
  const parsed = nativeQuotesPayloadSchema.safeParse(value);
  if (!parsed.success) throw new Error("QUOTES_STORE_INVALID");
  return parsed.data;
}
