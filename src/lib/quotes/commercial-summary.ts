import { calculateQuoteAdjustedPricing } from "./adjustments";
import {
  quoteOuvrageComponentCostPriceCents,
  type QuoteLine,
  type QuoteOuvrageComponent,
} from "./model";
import type { NativeQuoteRecord } from "./store";

export type CommercialQuoteSummary = {
  totalHtCents: number;
  soldHours: number;
  plannedDisbursementCents: number | null;
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

function lineBaseLaborCostCents(line: QuoteLine): number | null {
  let unitLaborCostCents = 0;

  for (const component of line.components ?? []) {
    if (componentActivity(component) === null) continue;
    const costRateCents = quoteOuvrageComponentCostPriceCents(component);
    if (costRateCents === null) return null;
    unitLaborCostCents += Math.round(component.quantity * costRateCents);
  }

  return Math.round(line.quantity * unitLaborCostCents);
}

function linePoseCostRateCents(line: QuoteLine): number | null {
  const poseComponents = (line.components ?? []).filter(
    (component) => componentActivity(component) === "POSE",
  );
  if (poseComponents.length === 0) return null;

  let hoursPerLineUnit = 0;
  let costPerLineUnitCents = 0;

  for (const component of poseComponents) {
    const costRateCents = quoteOuvrageComponentCostPriceCents(component);
    if (costRateCents === null) return null;
    hoursPerLineUnit += component.quantity;
    costPerLineUnitCents += component.quantity * costRateCents;
  }

  if (!Number.isFinite(hoursPerLineUnit) || hoursPerLineUnit <= 0) return null;
  return costPerLineUnitCents / hoursPerLineUnit;
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

  let laborCostCents = 0;
  let laborCostComplete = true;

  const soldHours = pricing.lines.reduce((total, adjustedLine) => {
    if (adjustedLine.optionStatus !== null && adjustedLine.optionStatus !== "RETAINED") {
      return total;
    }

    const line = linesById.get(adjustedLine.lineId);
    if (!line) return total;

    const baseLaborCostCents = lineBaseLaborCostCents(line);
    if (baseLaborCostCents === null) {
      laborCostComplete = false;
    } else {
      laborCostCents += baseLaborCostCents;
    }

    const addedPoseHours = adjustedLine.poseHours - adjustedLine.basePoseHours;
    if (addedPoseHours > 0) {
      const poseCostRateCents = linePoseCostRateCents(line);
      if (poseCostRateCents === null) {
        laborCostComplete = false;
      } else {
        laborCostCents += Math.round(addedPoseHours * poseCostRateCents);
      }
    }

    return total + nonPoseLaborHours(line) + adjustedLine.poseHours;
  }, 0);

  const plannedDisbursementCents =
    pricing.totalCostCents === null || !laborCostComplete
      ? null
      : Math.max(0, pricing.totalCostCents - laborCostCents);

  return {
    totalHtCents: pricing.totalSaleCents,
    soldHours: roundHours(soldHours),
    plannedDisbursementCents,
  };
}
