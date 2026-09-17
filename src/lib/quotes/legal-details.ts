import { z } from "zod";
import { vatRatePercentSchema } from "../vat";
import { quoteDateSchema } from "./model";
import {
  nativeQuoteRecordSchema,
  parseNativeQuotesPayload,
  type NativeQuoteRecord,
  type NativeQuotesPayload,
} from "./store";

export const quoteWorkScheduleInputSchema = z
  .object({
    startDate: quoteDateSchema,
    duration: z.string().trim().min(1).max(240),
    endDate: quoteDateSchema,
  })
  .superRefine((schedule, context) => {
    if (schedule.endDate < schedule.startDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "QUOTE_WORK_END_BEFORE_START",
      });
    }
  });

export const quoteLegalDetailsMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("updateWorkSchedule"),
    schedule: quoteWorkScheduleInputSchema,
  }),
  z.object({
    action: z.literal("setLineVatRate"),
    lineId: z.string().uuid(),
    ratePercent: vatRatePercentSchema.nullable(),
  }),
]);

export type QuoteLegalDetailsMutation = z.infer<typeof quoteLegalDetailsMutationSchema>;
export type QuoteLegalDetailsActor = { displayName: string };

function findDraftQuote(payload: NativeQuotesPayload, quoteId: string) {
  const quoteIndex = payload.quotes.findIndex((quote) => quote.id === quoteId);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");
  const quote = payload.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");
  return { quoteIndex, quote };
}

function saveQuote(
  payload: NativeQuotesPayload,
  quoteIndex: number,
  quote: NativeQuoteRecord,
  actor: QuoteLegalDetailsActor,
  now: Date,
) {
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    updatedAt: now.toISOString(),
    updatedByName: actor.displayName,
  });
  payload.quotes[quoteIndex] = updated;
  return { payload, focusQuoteId: updated.id };
}

export function initializeQuoteVatFromClient(
  source: NativeQuotesPayload,
  quoteId: string,
  defaultRatePercent: number,
  actor: QuoteLegalDetailsActor,
  now: Date = new Date(),
) {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  const { quoteIndex, quote } = findDraftQuote(payload, quoteId);
  const updated: NativeQuoteRecord = {
    ...quote,
    taxConfig: {
      defaultRatePercent: vatRatePercentSchema.parse(defaultRatePercent),
      lineOverrides: [],
    },
  };
  return saveQuote(payload, quoteIndex, updated, actor, now);
}

export function resolveQuoteLineVatRate(quote: NativeQuoteRecord, lineId: string): number {
  return (
    quote.taxConfig.lineOverrides.find((override) => override.lineId === lineId)?.ratePercent ??
    quote.taxConfig.defaultRatePercent
  );
}

export function quoteHasCompleteWorkSchedule(quote: NativeQuoteRecord): boolean {
  return Boolean(
    quote.workSchedule.startDate && quote.workSchedule.duration.trim() && quote.workSchedule.endDate,
  );
}

export function applyQuoteLegalDetailsMutation(
  source: NativeQuotesPayload,
  quoteId: string,
  rawInput: QuoteLegalDetailsMutation,
  actor: QuoteLegalDetailsActor,
  now: Date = new Date(),
) {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  const { quoteIndex, quote } = findDraftQuote(payload, quoteId);
  const input = quoteLegalDetailsMutationSchema.parse(rawInput);

  if (input.action === "updateWorkSchedule") {
    const schedule = quoteWorkScheduleInputSchema.parse(input.schedule);
    return saveQuote(
      payload,
      quoteIndex,
      { ...quote, workSchedule: schedule },
      actor,
      now,
    );
  }

  const line = quote.model.items.find(
    (item) => item.kind === "LINE" && item.id === input.lineId,
  );
  if (!line) throw new Error("QUOTE_LINE_NOT_FOUND");

  const lineOverrides = quote.taxConfig.lineOverrides.filter(
    (override) => override.lineId !== input.lineId,
  );
  if (
    input.ratePercent !== null &&
    input.ratePercent !== quote.taxConfig.defaultRatePercent
  ) {
    lineOverrides.push({ lineId: input.lineId, ratePercent: input.ratePercent });
  }

  return saveQuote(
    payload,
    quoteIndex,
    {
      ...quote,
      taxConfig: {
        ...quote.taxConfig,
        lineOverrides,
      },
    },
    actor,
    now,
  );
}
