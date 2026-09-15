import {
  calculateQuoteOuvrageMarginPercent,
  calculateQuoteOuvrageUnitCostCents,
  type QuoteItem,
} from "./model";

export type QuoteEconomicSummary = {
  totalSaleCents: number;
  totalCostCents: number | null;
  marginAmountCents: number | null;
  marginPercent: number | null;
};

function lineAmountCents(quantity: number, unitAmountCents: number): number {
  const amount = Math.round(quantity * unitAmountCents);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("QUOTE_SUMMARY_AMOUNT_INVALID");
  }
  return amount;
}

function addAmount(total: number, amount: number): number {
  const next = total + amount;
  if (!Number.isSafeInteger(next) || next < 0) {
    throw new Error("QUOTE_SUMMARY_AMOUNT_INVALID");
  }
  return next;
}

export function calculateQuoteEconomicSummary(items: QuoteItem[]): QuoteEconomicSummary {
  let totalSaleCents = 0;
  let totalCostCents = 0;
  let costComplete = true;

  for (const item of items) {
    if (item.kind !== "LINE") continue;

    totalSaleCents = addAmount(
      totalSaleCents,
      lineAmountCents(item.quantity, item.unitPriceCents ?? 0),
    );

    const components = item.components ?? [];
    if (components.length === 0) {
      costComplete = false;
      continue;
    }

    const unitCostCents = calculateQuoteOuvrageUnitCostCents(components);
    if (unitCostCents === null) {
      costComplete = false;
      continue;
    }

    totalCostCents = addAmount(totalCostCents, lineAmountCents(item.quantity, unitCostCents));
  }

  if (!costComplete) {
    return {
      totalSaleCents,
      totalCostCents: null,
      marginAmountCents: null,
      marginPercent: null,
    };
  }

  const marginAmountCents = totalSaleCents - totalCostCents;
  return {
    totalSaleCents,
    totalCostCents,
    marginAmountCents,
    marginPercent: calculateQuoteOuvrageMarginPercent(totalSaleCents, totalCostCents),
  };
}
