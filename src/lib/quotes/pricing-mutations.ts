import { z } from "zod";
import {
  calculateQuoteAdjustedPricing,
  quoteCustomerDiscountValueSchema,
  quoteOptionSchema,
  quotePricingAdjustmentSchema,
  quotePricingConfigSchema,
  type QuotePricingConfig,
} from "./adjustments";
import { assertQuoteOptionCanBeUpserted, assertQuotePricingIntegrity } from "./pricing-integrity";
import {
  nativeQuoteRecordSchema,
  parseNativeQuotesPayload,
  type NativeQuotesPayload,
} from "./store";

const upsertAdjustmentSchema = z.object({
  action: z.literal("upsertAdjustment"),
  quoteId: z.string().uuid(),
  adjustment: quotePricingAdjustmentSchema,
});

const removeAdjustmentSchema = z.object({
  action: z.literal("removeAdjustment"),
  quoteId: z.string().uuid(),
  adjustmentId: z.string().uuid(),
});

const upsertOptionSchema = z.object({
  action: z.literal("upsertOption"),
  quoteId: z.string().uuid(),
  option: quoteOptionSchema,
});

const removeOptionSchema = z.object({
  action: z.literal("removeOption"),
  quoteId: z.string().uuid(),
  optionId: z.string().uuid(),
});

const setCustomerDiscountSchema = z.object({
  action: z.literal("setCustomerDiscount"),
  quoteId: z.string().uuid(),
  discount: quoteCustomerDiscountValueSchema,
});

const clearCustomerDiscountSchema = z.object({
  action: z.literal("clearCustomerDiscount"),
  quoteId: z.string().uuid(),
});

export const quotePricingMutationSchema = z.discriminatedUnion("action", [
  upsertAdjustmentSchema,
  removeAdjustmentSchema,
  upsertOptionSchema,
  removeOptionSchema,
  setCustomerDiscountSchema,
  clearCustomerDiscountSchema,
]);

export type QuotePricingMutation = z.infer<typeof quotePricingMutationSchema>;

export type QuotePricingActor = {
  userId: string;
  displayName: string;
};

export type QuotePricingMutationResult = {
  payload: NativeQuotesPayload;
  focusQuoteId: string;
};

function nextConfig(
  configuration: QuotePricingConfig,
  elements: NativeQuotesPayload["quotes"][number]["model"]["items"],
  mutation: QuotePricingMutation,
): QuotePricingConfig {
  if (mutation.action === "upsertAdjustment") {
    const adjustments = [...configuration.adjustments];
    const indice = adjustments.findIndex((element) => element.id === mutation.adjustment.id);
    if (indice >= 0) adjustments[indice] = mutation.adjustment;
    else adjustments.push(mutation.adjustment);
    return quotePricingConfigSchema.parse({ ...configuration, adjustments });
  }

  if (mutation.action === "removeAdjustment") {
    return quotePricingConfigSchema.parse({
      ...configuration,
      adjustments: configuration.adjustments.filter(
        (element) => element.id !== mutation.adjustmentId,
      ),
    });
  }

  if (mutation.action === "setCustomerDiscount") {
    return quotePricingConfigSchema.parse({
      ...configuration,
      customerDiscount: mutation.discount,
    });
  }

  if (mutation.action === "clearCustomerDiscount") {
    return quotePricingConfigSchema.parse({
      ...configuration,
      customerDiscount: null,
    });
  }

  if (mutation.action === "upsertOption") {
    assertQuoteOptionCanBeUpserted(elements, configuration.options, mutation.option);
    const options = [...configuration.options];
    const indice = options.findIndex((element) => element.id === mutation.option.id);
    if (indice >= 0) options[indice] = mutation.option;
    else options.push(mutation.option);
    return quotePricingConfigSchema.parse({ ...configuration, options });
  }

  return quotePricingConfigSchema.parse({
    ...configuration,
    options: configuration.options.filter((element) => element.id !== mutation.optionId),
  });
}

export function applyQuotePricingMutation(
  source: NativeQuotesPayload,
  mutation: QuotePricingMutation,
  auteur: QuotePricingActor,
  maintenant: Date = new Date(),
): QuotePricingMutationResult {
  const contenu = structuredClone(parseNativeQuotesPayload(source));
  const quoteIndex = contenu.quotes.findIndex((quote) => quote.id === mutation.quoteId);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");

  const quote = contenu.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");

  const pricingConfig = nextConfig(quote.pricingConfig, quote.model.items, mutation);
  assertQuotePricingIntegrity(quote.model.items, pricingConfig);
  calculateQuoteAdjustedPricing(quote.model.items, pricingConfig);

  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    pricingConfig,
    updatedAt: maintenant.toISOString(),
    updatedByName: auteur.displayName,
  });
  contenu.quotes[quoteIndex] = updated;
  return { payload: contenu, focusQuoteId: updated.id };
}
