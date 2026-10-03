export type QuotePricingDriver = "MARGIN" | "SALE_PRICE";

function assertMoneyCents(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("QUOTE_PRICING_MONEY_INVALID");
  }
  return value;
}

function assertMarginPercent(value: number): number {
  if (!Number.isFinite(value) || value < -100) {
    throw new Error("QUOTE_PRICING_MARGIN_INVALID");
  }
  return value;
}

export function parseQuoteMarginInput(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) throw new Error("QUOTE_PRICING_MARGIN_INVALID");
  return assertMarginPercent(Number(normalized));
}

export function quoteMarginToInput(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  const rounded = Math.round(value * 100) / 100;
  return String(rounded).replace(".", ",");
}

export function calculateQuoteSalePriceFromMarginCents(
  costPriceCents: number,
  marginPercent: number,
): number {
  const cost = assertMoneyCents(costPriceCents);
  const margin = assertMarginPercent(marginPercent);
  const salePriceCents = Math.round(cost * (1 + margin / 100));
  return assertMoneyCents(salePriceCents);
}

export function calculateQuoteMarginFromSalePrice(
  costPriceCents: number,
  salePriceCents: number,
): number | null {
  const cost = assertMoneyCents(costPriceCents);
  const sale = assertMoneyCents(salePriceCents);
  if (cost === 0) return sale === 0 ? 0 : null;
  return ((sale - cost) / cost) * 100;
}
