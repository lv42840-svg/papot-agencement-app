import { calculateQuoteAdjustedPricing } from "./adjustments";
import {
  quoteOuvrageComponentCostPriceCents,
  type QuoteLine,
  type QuoteOuvrageComponent,
} from "./model";
import type { NativeQuoteRecord } from "./store";

export type CommercialSoldHours = {
  be: number;
  workshop: number;
  install: number;
  total: number;
};

export type CommercialQuoteSummary = {
  totalHtCents: number;
  soldHours: number;
  soldHoursByActivity: CommercialSoldHours;
  plannedDisbursementCents: number | null;
  plannedMarginCents: number | null;
};

export type CommercialContractSummary = {
  quoteCount: number;
  totalHtCents: number;
  soldHours: number;
  soldHoursByActivity: CommercialSoldHours;
  plannedDisbursementCents: number | null;
  plannedMarginCents: number | null;
};

function componentActivity(component: QuoteOuvrageComponent): "BE" | "ATELIER" | "POSE" | null {
  return component.activity ?? component.librarySource?.component.activity ?? null;
}

function nonPoseLaborHours(line: QuoteLine): { be: number; workshop: number } {
  let bePerLineUnit = 0;
  let workshopPerLineUnit = 0;

  for (const component of line.components ?? []) {
    const activity = componentActivity(component);
    if (activity === "BE") bePerLineUnit += component.quantity;
    if (activity === "ATELIER") workshopPerLineUnit += component.quantity;
  }

  return {
    be: line.quantity * bePerLineUnit,
    workshop: line.quantity * workshopPerLineUnit,
  };
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
  let soldBeHours = 0;
  let soldWorkshopHours = 0;
  let soldInstallHours = 0;

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

    const nonPoseHours = nonPoseLaborHours(line);
    soldBeHours += nonPoseHours.be;
    soldWorkshopHours += nonPoseHours.workshop;
    soldInstallHours += adjustedLine.poseHours;

    return total + nonPoseHours.be + nonPoseHours.workshop + adjustedLine.poseHours;
  }, 0);

  const plannedDisbursementCents =
    pricing.totalCostCents === null || !laborCostComplete
      ? null
      : Math.max(0, pricing.totalCostCents - laborCostCents);

  return {
    totalHtCents: pricing.totalSaleCents,
    soldHours: roundHours(soldHours),
    soldHoursByActivity: {
      be: roundHours(soldBeHours),
      workshop: roundHours(soldWorkshopHours),
      install: roundHours(soldInstallHours),
      total: roundHours(soldHours),
    },
    plannedDisbursementCents,
    plannedMarginCents: pricing.marginAmountCents,
  };
}

export function calculateCommercialContractSummary(
  quotes: NativeQuoteRecord[],
  retainedQuoteIds: readonly string[],
): CommercialContractSummary {
  const retained = new Set(retainedQuoteIds);
  const selected = quotes.filter((quote) => retained.has(quote.id));
  let totalHtCents = 0;
  let soldHours = 0;
  let soldBeHours = 0;
  let soldWorkshopHours = 0;
  let soldInstallHours = 0;
  let plannedDisbursementCents = 0;
  let plannedMarginCents = 0;
  let disbursementComplete = true;
  let marginComplete = true;

  for (const quote of selected) {
    const summary = calculateCommercialQuoteSummary(quote);
    totalHtCents += summary.totalHtCents;
    soldHours += summary.soldHours;
    soldBeHours += summary.soldHoursByActivity.be;
    soldWorkshopHours += summary.soldHoursByActivity.workshop;
    soldInstallHours += summary.soldHoursByActivity.install;
    if (summary.plannedDisbursementCents === null) {
      disbursementComplete = false;
    } else {
      plannedDisbursementCents += summary.plannedDisbursementCents;
    }
    if (summary.plannedMarginCents === null) {
      marginComplete = false;
    } else {
      plannedMarginCents += summary.plannedMarginCents;
    }
  }

  return {
    quoteCount: selected.length,
    totalHtCents,
    soldHours: roundHours(soldHours),
    soldHoursByActivity: {
      be: roundHours(soldBeHours),
      workshop: roundHours(soldWorkshopHours),
      install: roundHours(soldInstallHours),
      total: roundHours(soldHours),
    },
    plannedDisbursementCents: disbursementComplete ? plannedDisbursementCents : null,
    plannedMarginCents: marginComplete ? plannedMarginCents : null,
  };
}
