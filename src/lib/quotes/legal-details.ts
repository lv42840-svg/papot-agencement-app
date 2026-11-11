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
  .superRefine((schedule, contexte) => {
    if (schedule.endDate < schedule.startDate) {
      contexte.addIssue({
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

function findDraftQuote(contenu: NativeQuotesPayload, idDevis: string) {
  const quoteIndex = contenu.quotes.findIndex((quote) => quote.id === idDevis);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");
  const quote = contenu.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");
  return { quoteIndex, quote };
}

function saveQuote(
  contenu: NativeQuotesPayload,
  quoteIndex: number,
  quote: NativeQuoteRecord,
  auteur: QuoteLegalDetailsActor,
  maintenant: Date,
) {
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    updatedAt: maintenant.toISOString(),
    updatedByName: auteur.displayName,
  });
  contenu.quotes[quoteIndex] = updated;
  return { payload: contenu, focusQuoteId: updated.id };
}

export function initializeQuoteVatFromClient(
  source: NativeQuotesPayload,
  idDevis: string,
  defaultRatePercent: number,
  auteur: QuoteLegalDetailsActor,
  maintenant: Date = new Date(),
) {
  const contenu = structuredClone(parseNativeQuotesPayload(source));
  const { quoteIndex, quote } = findDraftQuote(contenu, idDevis);
  const updated: NativeQuoteRecord = {
    ...quote,
    taxConfig: {
      defaultRatePercent: vatRatePercentSchema.parse(defaultRatePercent),
      lineOverrides: [],
    },
  };
  return saveQuote(contenu, quoteIndex, updated, auteur, maintenant);
}

export function resolveQuoteLineVatRate(quote: NativeQuoteRecord, lineId: string): number {
  return (
    quote.taxConfig.lineOverrides.find((override) => override.lineId === lineId)?.ratePercent ??
    quote.taxConfig.defaultRatePercent
  );
}

export function quoteHasCompleteWorkSchedule(quote: NativeQuoteRecord): boolean {
  return Boolean(
    quote.workSchedule.startDate &&
      quote.workSchedule.duration.trim() &&
      quote.workSchedule.endDate,
  );
}

export function applyQuoteLegalDetailsMutation(
  source: NativeQuotesPayload,
  idDevis: string,
  rawInput: QuoteLegalDetailsMutation,
  auteur: QuoteLegalDetailsActor,
  maintenant: Date = new Date(),
) {
  const contenu = structuredClone(parseNativeQuotesPayload(source));
  const { quoteIndex, quote } = findDraftQuote(contenu, idDevis);
  const saisie = quoteLegalDetailsMutationSchema.parse(rawInput);

  if (saisie.action === "updateWorkSchedule") {
    const schedule = quoteWorkScheduleInputSchema.parse(saisie.schedule);
    return saveQuote(contenu, quoteIndex, { ...quote, workSchedule: schedule }, auteur, maintenant);
  }

  const ligne = quote.model.items.find(
    (element) => element.kind === "LINE" && element.id === saisie.lineId,
  );
  if (!ligne) throw new Error("QUOTE_LINE_NOT_FOUND");

  const lineOverrides = quote.taxConfig.lineOverrides.filter(
    (override) => override.lineId !== saisie.lineId,
  );
  if (saisie.ratePercent !== null && saisie.ratePercent !== quote.taxConfig.defaultRatePercent) {
    lineOverrides.push({ lineId: saisie.lineId, ratePercent: saisie.ratePercent });
  }

  return saveQuote(
    contenu,
    quoteIndex,
    {
      ...quote,
      taxConfig: {
        ...quote.taxConfig,
        lineOverrides,
      },
    },
    auteur,
    maintenant,
  );
}
