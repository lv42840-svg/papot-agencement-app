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

function lineAmountCents(quantite: number, montantUnitaireCentimes: number): number {
  const montant = Math.round(quantite * montantUnitaireCentimes);
  if (!Number.isSafeInteger(montant) || montant < 0) {
    throw new Error("QUOTE_SUMMARY_AMOUNT_INVALID");
  }
  return montant;
}

function addAmount(total: number, montant: number): number {
  const nouveauTotal = total + montant;
  if (!Number.isSafeInteger(nouveauTotal) || nouveauTotal < 0) {
    throw new Error("QUOTE_SUMMARY_AMOUNT_INVALID");
  }
  return nouveauTotal;
}

export function calculateQuoteEconomicSummary(elements: QuoteItem[]): QuoteEconomicSummary {
  let totalVenteCentimes = 0;
  let totalCoutCentimes = 0;
  let coutComplet = true;

  for (const element of elements) {
    if (element.kind !== "LINE") continue;

    totalVenteCentimes = addAmount(
      totalVenteCentimes,
      lineAmountCents(element.quantity, element.unitPriceCents ?? 0),
    );

    const composants = element.components ?? [];
    if (composants.length === 0) {
      coutComplet = false;
      continue;
    }

    const coutUnitaireCentimes = calculateQuoteOuvrageUnitCostCents(composants);
    if (coutUnitaireCentimes === null) {
      coutComplet = false;
      continue;
    }

    totalCoutCentimes = addAmount(
      totalCoutCentimes,
      lineAmountCents(element.quantity, coutUnitaireCentimes),
    );
  }

  if (!coutComplet) {
    return {
      totalSaleCents: totalVenteCentimes,
      totalCostCents: null,
      marginAmountCents: null,
      marginPercent: null,
    };
  }

  const montantMargeCentimes = totalVenteCentimes - totalCoutCentimes;
  return {
    totalSaleCents: totalVenteCentimes,
    totalCostCents: totalCoutCentimes,
    marginAmountCents: montantMargeCentimes,
    marginPercent: calculateQuoteOuvrageMarginPercent(totalVenteCentimes, totalCoutCentimes),
  };
}
