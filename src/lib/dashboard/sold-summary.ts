import type { CommercialCase } from "../commercial/domain";
import { calculateCommercialContractSummary } from "../quotes/commercial-summary";
import type { NativeQuoteRecord } from "../quotes/store";

export type SoldPeriodSummary = {
  soldCents: number | null;
  plannedMarginCents: number | null;
  confirmedCases: number;
  incompleteCases: number;
};

export type DashboardSoldSummary = {
  year: string;
  month: string;
  yearly: SoldPeriodSummary;
  monthly: SoldPeriodSummary;
};

/**
 * Montants CONTRACTUELS rattachés à la date de confirmation de l'affaire.
 * Ce ne sont ni des factures ni du chiffre d'affaires comptable.
 * Un TS ajouté ultérieurement reste rattaché à la confirmation de l'affaire.
 */
export function calculateDashboardSoldSummary(
  cases: readonly CommercialCase[],
  quotes: readonly NativeQuoteRecord[],
  now = new Date(),
): DashboardSoldSummary {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = year + "-" + (parts.find((part) => part.type === "month")?.value ?? "");
  const byId = new Map(quotes.map((quote) => [quote.id, quote]));

  function forPeriod(period: string): SoldPeriodSummary {
    let soldCents = 0;
    let plannedMarginCents = 0;
    let soldComplete = true;
    let marginComplete = true;
    let confirmedCases = 0;
    let incompleteCases = 0;

    for (const item of cases) {
      if (item.status !== "CONFIRMED" || !item.confirmedAt) continue;
      const date = item.confirmedAt.slice(0, 10);
      if (!date.startsWith(period)) continue;
      confirmedCases += 1;

      const retained = item.retainedQuoteIds.map((id) => byId.get(id));
      if (
        retained.length === 0 ||
        retained.some((quote) => !quote || quote.commercialCaseId !== item.id)
      ) {
        soldComplete = false;
        marginComplete = false;
        incompleteCases += 1;
        continue;
      }

      const summary = calculateCommercialContractSummary(
        retained.filter((quote): quote is NativeQuoteRecord => Boolean(quote)),
        item.retainedQuoteIds,
      );
      soldCents += summary.totalHtCents;
      if (summary.plannedMarginCents === null) {
        marginComplete = false;
      } else {
        plannedMarginCents += summary.plannedMarginCents;
      }
    }

    return {
      soldCents: soldComplete ? soldCents : null,
      plannedMarginCents: marginComplete && soldComplete ? plannedMarginCents : null,
      confirmedCases,
      incompleteCases,
    };
  }

  return { year, month, yearly: forPeriod(year), monthly: forPeriod(month) };
}
