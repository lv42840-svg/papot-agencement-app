import type { ChantierHours, ChantierRecord } from "./domain";
import type { CommercialCase } from "../commercial/domain";
import { calculateCommercialQuoteSummary } from "../quotes/commercial-summary";
import type { NativeQuoteRecord, NativeQuotesPayload } from "../quotes/store";

export type ChantierActualCostSnapshot = {
  laborCostCents: number | null;
  purchaseCostCents: number | null;
};

export type ChantierProfitabilityQuote = {
  quoteId: string;
  quoteKind: NativeQuoteRecord["quoteKind"];
  quoteNumber: string | null;
  subject: string;
  variantName: string;
  version: number;
  saleCents: number;
  soldHours: ChantierHours & { total: number };
  plannedDisbursementCents: number | null;
  plannedMarginCents: number | null;
};

export type ChantierProfitability = {
  soldCents: number | null;
  plannedDisbursementCents: number | null;
  plannedMarginCents: number | null;
  plannedMarginPercent: number | null;
  plannedHours: ChantierHours & { total: number };
  actualHours: ChantierHours & { total: number };
  actualLaborCostCents: number | null;
  actualPurchaseCostCents: number | null;
  actualTotalCostCents: number | null;
  actualMarginCents: number | null;
  actualMarginPercent: number | null;
  retainedQuotes: ChantierProfitabilityQuote[];
  missingRetainedQuoteIds: string[];
};

function totalHours(hours: ChantierHours): ChantierHours & { total: number } {
  return {
    ...hours,
    total: hours.be + hours.workshop + hours.install,
  };
}

function marginPercent(saleCents: number, costCents: number): number | null {
  if (costCents === 0) return saleCents === 0 ? 0 : null;
  return ((saleCents - costCents) / costCents) * 100;
}

function addSafeMoney(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("CHANTIER_PROFITABILITY_MONEY_INVALID");
  }
  return total;
}

function retainedQuotes(
  commercialCase: CommercialCase | null,
  quotes: NativeQuotesPayload,
): {
  records: NativeQuoteRecord[];
  missingIds: string[];
} {
  if (!commercialCase) return { records: [], missingIds: [] };

  const quotesById = new Map(quotes.quotes.map((quote) => [quote.id, quote]));
  const records: NativeQuoteRecord[] = [];
  const missingIds: string[] = [];

  for (const quoteId of commercialCase.retainedQuoteIds) {
    const quote = quotesById.get(quoteId);
    if (!quote || quote.commercialCaseId !== commercialCase.id) {
      missingIds.push(quoteId);
      continue;
    }
    records.push(quote);
  }

  return { records, missingIds };
}

export function calculateChantierProfitability(
  chantier: ChantierRecord,
  commercialCase: CommercialCase | null,
  quotes: NativeQuotesPayload,
  actualCosts: ChantierActualCostSnapshot = {
    laborCostCents: null,
    purchaseCostCents: null,
  },
): ChantierProfitability {
  const retained = retainedQuotes(commercialCase, quotes);
  const summaries = retained.records.map((quote) => {
    const summary = calculateCommercialQuoteSummary(quote);
    return {
      quoteId: quote.id,
      quoteKind: quote.quoteKind,
      quoteNumber: quote.finalPdf?.quoteNumber ?? null,
      subject: quote.model.subject,
      variantName: quote.variantName,
      version: quote.version,
      saleCents: summary.totalHtCents,
      soldHours: summary.soldHoursByActivity,
      plannedDisbursementCents: summary.plannedDisbursementCents,
      plannedMarginCents: summary.plannedMarginCents,
    } satisfies ChantierProfitabilityQuote;
  });

  const soldComplete =
    commercialCase !== null &&
    commercialCase.retainedQuoteIds.length > 0 &&
    retained.missingIds.length === 0;
  const soldCents = soldComplete
    ? summaries.reduce((total, quote) => addSafeMoney(total, quote.saleCents), 0)
    : null;

  const plannedDisbursementComplete =
    soldComplete && summaries.every((quote) => quote.plannedDisbursementCents !== null);
  const plannedDisbursementCents = plannedDisbursementComplete
    ? summaries.reduce(
        (total, quote) => addSafeMoney(total, quote.plannedDisbursementCents ?? 0),
        0,
      )
    : null;
  const plannedMarginComplete =
    soldComplete && summaries.every((quote) => quote.plannedMarginCents !== null);
  const plannedMarginCents = plannedMarginComplete
    ? summaries.reduce((total, quote) => total + (quote.plannedMarginCents ?? 0), 0)
    : null;
  const plannedTotalCostCents =
    soldCents === null || plannedMarginCents === null ? null : soldCents - plannedMarginCents;
  const plannedMarginPercent =
    soldCents === null || plannedTotalCostCents === null
      ? null
      : marginPercent(soldCents, plannedTotalCostCents);

  const actualCostsComplete =
    actualCosts.laborCostCents !== null && actualCosts.purchaseCostCents !== null;
  const actualTotalCostCents = actualCostsComplete
    ? addSafeMoney(actualCosts.laborCostCents ?? 0, actualCosts.purchaseCostCents ?? 0)
    : null;
  const actualMarginCents =
    soldCents === null || actualTotalCostCents === null ? null : soldCents - actualTotalCostCents;
  const actualMarginPercent =
    soldCents === null || actualTotalCostCents === null
      ? null
      : marginPercent(soldCents, actualTotalCostCents);

  const plannedHours = soldComplete
    ? summaries.reduce(
        (total, quote) => ({
          be: total.be + quote.soldHours.be,
          workshop: total.workshop + quote.soldHours.workshop,
          install: total.install + quote.soldHours.install,
          total: total.total + quote.soldHours.total,
        }),
        { be: 0, workshop: 0, install: 0, total: 0 },
      )
    : { be: 0, workshop: 0, install: 0, total: 0 };

  return {
    soldCents,
    plannedDisbursementCents,
    plannedMarginCents,
    plannedMarginPercent,
    plannedHours,
    actualHours: totalHours(chantier.actualHours),
    actualLaborCostCents: actualCosts.laborCostCents,
    actualPurchaseCostCents: actualCosts.purchaseCostCents,
    actualTotalCostCents,
    actualMarginCents,
    actualMarginPercent,
    retainedQuotes: summaries,
    missingRetainedQuoteIds: retained.missingIds,
  };
}
