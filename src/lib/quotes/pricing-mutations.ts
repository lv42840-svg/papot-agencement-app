import { z } from "zod";
import {
  quoteOptionSchema,
  quotePricingAdjustmentSchema,
  quotePricingConfigSchema,
  type QuotePricingConfig,
} from "./adjustments";
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

export const quotePricingMutationSchema = z.discriminatedUnion("action", [
  upsertAdjustmentSchema,
  removeAdjustmentSchema,
  upsertOptionSchema,
  removeOptionSchema,
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

function validateOptionTarget(
  items: NativeQuotesPayload["quotes"][number]["model"]["items"],
  option: Extract<QuotePricingMutation, { action: "upsertOption" }>["option"],
) {
  const target = items.find((item) => item.id === option.targetItemId);
  if (!target) throw new Error("QUOTE_OPTION_TARGET_NOT_FOUND");
  if (target.kind === "COMMENT") throw new Error("QUOTE_OPTION_TARGET_INVALID");
  if (target.kind !== option.targetKind) throw new Error("QUOTE_OPTION_TARGET_INVALID");
}

function nextConfig(
  config: QuotePricingConfig,
  items: NativeQuotesPayload["quotes"][number]["model"]["items"],
  mutation: QuotePricingMutation,
): QuotePricingConfig {
  if (mutation.action === "upsertAdjustment") {
    const adjustments = [...config.adjustments];
    const index = adjustments.findIndex((item) => item.id === mutation.adjustment.id);
    if (index >= 0) adjustments[index] = mutation.adjustment;
    else adjustments.push(mutation.adjustment);
    return quotePricingConfigSchema.parse({ ...config, adjustments });
  }

  if (mutation.action === "removeAdjustment") {
    return quotePricingConfigSchema.parse({
      ...config,
      adjustments: config.adjustments.filter((item) => item.id !== mutation.adjustmentId),
    });
  }

  if (mutation.action === "upsertOption") {
    validateOptionTarget(items, mutation.option);
    const options = [...config.options];
    const sameTarget = options.find(
      (item) =>
        item.targetItemId === mutation.option.targetItemId && item.id !== mutation.option.id,
    );
    if (sameTarget) throw new Error("QUOTE_OPTION_TARGET_DUPLICATE");
    const index = options.findIndex((item) => item.id === mutation.option.id);
    if (index >= 0) options[index] = mutation.option;
    else options.push(mutation.option);
    return quotePricingConfigSchema.parse({ ...config, options });
  }

  return quotePricingConfigSchema.parse({
    ...config,
    options: config.options.filter((item) => item.id !== mutation.optionId),
  });
}

export function applyQuotePricingMutation(
  source: NativeQuotesPayload,
  mutation: QuotePricingMutation,
  actor: QuotePricingActor,
  now: Date = new Date(),
): QuotePricingMutationResult {
  const payload = structuredClone(parseNativeQuotesPayload(source));
  const quoteIndex = payload.quotes.findIndex((quote) => quote.id === mutation.quoteId);
  if (quoteIndex < 0) throw new Error("QUOTE_NOT_FOUND");

  const quote = payload.quotes[quoteIndex];
  if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");

  const pricingConfig = nextConfig(quote.pricingConfig, quote.model.items, mutation);
  const updated = nativeQuoteRecordSchema.parse({
    ...quote,
    pricingConfig,
    updatedAt: now.toISOString(),
    updatedByName: actor.displayName,
  });
  payload.quotes[quoteIndex] = updated;
  return { payload, focusQuoteId: updated.id };
}
