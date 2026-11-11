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
  plannedLaborCostCents: number | null;
  plannedTotalCostCents: number | null;
  plannedMarginCents: number | null;
};

export type CommercialContractSummary = {
  quoteCount: number;
  totalHtCents: number;
  soldHours: number;
  soldHoursByActivity: CommercialSoldHours;
  plannedDisbursementCents: number | null;
  plannedLaborCostCents: number | null;
  plannedTotalCostCents: number | null;
  plannedMarginCents: number | null;
};

function componentActivity(component: QuoteOuvrageComponent): "BE" | "ATELIER" | "POSE" | null {
  return component.activity ?? component.librarySource?.component.activity ?? null;
}

function nonPoseLaborHours(ligne: QuoteLine): { be: number; workshop: number } {
  let bePerLineUnit = 0;
  let workshopPerLineUnit = 0;

  for (const component of ligne.components ?? []) {
    const activity = componentActivity(component);
    if (activity === "BE") bePerLineUnit += component.quantity;
    if (activity === "ATELIER") workshopPerLineUnit += component.quantity;
  }

  return {
    be: ligne.quantity * bePerLineUnit,
    workshop: ligne.quantity * workshopPerLineUnit,
  };
}

function lineBaseLaborCostCents(ligne: QuoteLine): number | null {
  let unitLaborCostCents = 0;

  for (const component of ligne.components ?? []) {
    if (componentActivity(component) === null) continue;
    const costRateCents = quoteOuvrageComponentCostPriceCents(component);
    // An unpriced labor hour cannot be treated as free: it would inflate margin.
    if (costRateCents === null || costRateCents === 0) return null;
    unitLaborCostCents += Math.round(component.quantity * costRateCents);
  }

  return Math.round(ligne.quantity * unitLaborCostCents);
}

function linePoseCostRateCents(ligne: QuoteLine): number | null {
  const poseComponents = (ligne.components ?? []).filter(
    (component) => componentActivity(component) === "POSE",
  );
  if (poseComponents.length === 0) return null;

  let hoursPerLineUnit = 0;
  let costPerLineUnitCents = 0;

  for (const component of poseComponents) {
    const costRateCents = quoteOuvrageComponentCostPriceCents(component);
    if (costRateCents === null || costRateCents === 0) return null;
    hoursPerLineUnit += component.quantity;
    costPerLineUnitCents += component.quantity * costRateCents;
  }

  if (!Number.isFinite(hoursPerLineUnit) || hoursPerLineUnit <= 0) return null;
  return costPerLineUnitCents / hoursPerLineUnit;
}

function roundHours(valeur: number): number {
  return Math.round(valeur * 1_000_000) / 1_000_000;
}

export function calculateCommercialQuoteSummary(quote: NativeQuoteRecord): CommercialQuoteSummary {
  const pricing = calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig);
  const linesById = new Map(
    quote.model.items
      .filter((element): element is QuoteLine => element.kind === "LINE")
      .map((ligne) => [ligne.id, ligne]),
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

    const ligne = linesById.get(adjustedLine.lineId);
    if (!ligne) return total;

    const baseLaborCostCents = lineBaseLaborCostCents(ligne);
    if (baseLaborCostCents === null) {
      laborCostComplete = false;
    } else {
      laborCostCents += baseLaborCostCents;
    }

    const addedPoseHours = adjustedLine.poseHours - adjustedLine.basePoseHours;
    if (addedPoseHours > 0) {
      const poseCostRateCents = linePoseCostRateCents(ligne);
      if (poseCostRateCents === null) {
        laborCostComplete = false;
      } else {
        laborCostCents += Math.round(addedPoseHours * poseCostRateCents);
      }
    }

    const nonPoseHours = nonPoseLaborHours(ligne);
    soldBeHours += nonPoseHours.be;
    soldWorkshopHours += nonPoseHours.workshop;
    soldInstallHours += adjustedLine.poseHours;

    return total + nonPoseHours.be + nonPoseHours.workshop + adjustedLine.poseHours;
  }, 0);

  const complete = pricing.totalCostCents !== null && laborCostComplete;
  const plannedLaborCostCents = complete ? laborCostCents : null;
  const plannedTotalCostCents = complete ? pricing.totalCostCents : null;
  // The quote engine already includes component labor in total cost.
  // The margin MUST subtract total cost once; never subtract planned labor twice.
  const plannedDisbursementCents = complete
    ? Math.max(0, (pricing.totalCostCents ?? 0) - laborCostCents)
    : null;

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
    plannedLaborCostCents,
    plannedTotalCostCents,
    plannedMarginCents:
      plannedTotalCostCents === null ? null : pricing.totalSaleCents - plannedTotalCostCents,
  };
}

export function calculateCommercialContractSummary(
  quotes: NativeQuoteRecord[],
  retainedQuoteIds: readonly string[],
): CommercialContractSummary {
  const retained = new Set(retainedQuoteIds);
  const selectionne = quotes.filter((quote) => retained.has(quote.id));
  let totalHtCents = 0;
  let soldHours = 0;
  let soldBeHours = 0;
  let soldWorkshopHours = 0;
  let soldInstallHours = 0;
  let plannedDisbursementCents = 0;
  let plannedLaborCostCents = 0;
  let plannedTotalCostCents = 0;
  let plannedMarginCents = 0;
  let disbursementComplete = true;
  let laborComplete = true;
  let totalCostComplete = true;
  let marginComplete = true;

  for (const quote of selectionne) {
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
    if (summary.plannedLaborCostCents === null) {
      laborComplete = false;
    } else {
      plannedLaborCostCents += summary.plannedLaborCostCents;
    }
    if (summary.plannedTotalCostCents === null) {
      totalCostComplete = false;
    } else {
      plannedTotalCostCents += summary.plannedTotalCostCents;
    }
    if (summary.plannedMarginCents === null) {
      marginComplete = false;
    } else {
      plannedMarginCents += summary.plannedMarginCents;
    }
  }

  return {
    quoteCount: selectionne.length,
    totalHtCents,
    soldHours: roundHours(soldHours),
    soldHoursByActivity: {
      be: roundHours(soldBeHours),
      workshop: roundHours(soldWorkshopHours),
      install: roundHours(soldInstallHours),
      total: roundHours(soldHours),
    },
    plannedDisbursementCents: disbursementComplete ? plannedDisbursementCents : null,
    plannedLaborCostCents: laborComplete ? plannedLaborCostCents : null,
    plannedTotalCostCents: totalCostComplete ? plannedTotalCostCents : null,
    plannedMarginCents: marginComplete ? plannedMarginCents : null,
  };
}
