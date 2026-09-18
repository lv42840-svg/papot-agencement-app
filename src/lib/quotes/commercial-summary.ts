import { calculateQuoteAdjustedPricing } from "./adjustments";
import type { QuoteLine, QuoteOuvrageComponent } from "./model";
import type { NativeQuoteRecord } from "./store";

export type CommercialQuoteSummary = {
  totalHtCents: number;
  soldHours: number;
  estimatedCostCents: number | null;
};

function componentActivity(component: QuoteOuvrageComponent): "BE" | "ATELIER" | "POSE" | null {
  return component.activity ?? component.librarySource?.component.activity ?? null;
}

function nonPoseLaborHours(line: QuoteLine): number {
  const hoursPerLineUnit = (line.components ?? []).reduce((total, component) => {
    const activity = componentActivity(component);
    if (activity !== "BE" && activity !== "ATELIER") return total;
    return total + component.quantity;
  }, 0);

  return line.quantity * hoursPerLineUnit;
}

function roundHours(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function calculateCommercialQuoteSummary(quote: NativeQuoteRecord): CommercialQuoteSummary {
  const pricing = calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig);
  const linesById = new Map(
    quote.model.items
      .filter((item): item is QuoteLine => item.kind === "LINE")
      .map((line) => [line.id, line]),
  );

  const soldHours = pricing.lines.reduce((total, adjustedLine) => {
    if (adjustedLine.optionStatus !== null && adjustedLine.optionStatus !== "RETAINED") {
      return total;
    }

    const line = linesById.get(adjustedLine.lineId);
    if (!line) return total;

    return total + nonPoseLaborHours(line) + adjustedLine.poseHours;
  }, 0);

  return {
    totalHtCents: pricing.totalSaleCents,
    soldHours: roundHours(soldHours),
    estimatedCostCents: pricing.totalCostCents,
  };
}
