import type { QuoteOption, QuotePricingConfig } from "./adjustments";
import { quotePricingConfigSchema } from "./adjustments";
import type { QuoteItem } from "./model";
import type { NativeQuotesPayload } from "./store";

type OptionTarget = Exclude<QuoteItem, { kind: "COMMENT" }>;

function optionTarget(items: QuoteItem[], option: QuoteOption): OptionTarget {
  const target = items.find((item) => item.id === option.targetItemId);
  if (!target) throw new Error("QUOTE_OPTION_TARGET_NOT_FOUND");
  if (target.kind === "COMMENT" || target.kind !== option.targetKind) {
    throw new Error("QUOTE_OPTION_TARGET_INVALID");
  }
  return target;
}

function targetContains(
  items: QuoteItem[],
  ancestor: OptionTarget,
  descendant: OptionTarget,
): boolean {
  if (ancestor.id === descendant.id) return true;
  if (ancestor.kind === "LINE") return false;

  if (descendant.parentId === ancestor.id) return true;
  if (!descendant.parentId) return false;

  const parent = items.find((item) => item.id === descendant.parentId);
  return parent?.parentId === ancestor.id;
}

function optionsOverlap(items: QuoteItem[], left: QuoteOption, right: QuoteOption): boolean {
  const leftTarget = optionTarget(items, left);
  const rightTarget = optionTarget(items, right);
  return (
    targetContains(items, leftTarget, rightTarget) || targetContains(items, rightTarget, leftTarget)
  );
}

export function assertQuoteOptionCanBeUpserted(
  items: QuoteItem[],
  existingOptions: QuoteOption[],
  candidate: QuoteOption,
): void {
  optionTarget(items, candidate);
  for (const existing of existingOptions) {
    if (existing.id === candidate.id) continue;
    if (optionsOverlap(items, existing, candidate)) {
      throw new Error("QUOTE_OPTION_TARGET_DUPLICATE");
    }
  }
}

export function assertQuotePricingIntegrity(
  items: QuoteItem[],
  pricingConfig: QuotePricingConfig,
): void {
  const parsed = quotePricingConfigSchema.parse(pricingConfig);
  for (const option of parsed.options) optionTarget(items, option);

  for (let leftIndex = 0; leftIndex < parsed.options.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < parsed.options.length; rightIndex += 1) {
      if (optionsOverlap(items, parsed.options[leftIndex], parsed.options[rightIndex])) {
        throw new Error("QUOTE_OPTION_TARGET_DUPLICATE");
      }
    }
  }
}

export function normalizeQuotePricingAfterModelMutation(
  payload: NativeQuotesPayload,
  quoteId: string,
): NativeQuotesPayload {
  const quote = payload.quotes.find((candidate) => candidate.id === quoteId);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");

  const itemsById = new Map(quote.model.items.map((item) => [item.id, item]));
  const options = quote.pricingConfig.options.filter((option) => {
    const target = itemsById.get(option.targetItemId);
    return Boolean(target && target.kind !== "COMMENT" && target.kind === option.targetKind);
  });
  const pricingConfig = quotePricingConfigSchema.parse({ ...quote.pricingConfig, options });
  assertQuotePricingIntegrity(quote.model.items, pricingConfig);
  quote.pricingConfig = pricingConfig;
  return payload;
}
