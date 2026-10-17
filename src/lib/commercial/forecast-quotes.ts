import type { CommercialCase } from "./domain";
import { calculateCommercialQuoteSummary } from "../quotes/commercial-summary";
import type { NativeQuoteRecord } from "../quotes/store";

export type ForecastActivityHours = { be: number; workshop: number; install: number };

export function effectiveCommercialForecastHours(
  item: Pick<CommercialCase, "provisionHours" | "forecastQuoteIds" | "id">,
  quotes: readonly NativeQuoteRecord[],
): ForecastActivityHours {
  // null means legacy/manual mode, including all existing commercial cases.
  if (item.forecastQuoteIds == null) return item.provisionHours;
  const ids = new Set(item.forecastQuoteIds);
  const total = { be: 0, workshop: 0, install: 0 };
  for (const quote of quotes) {
    if (!ids.has(quote.id) || quote.commercialCaseId !== item.id) continue;
    const hours = calculateCommercialQuoteSummary(quote).soldHoursByActivity;
    total.be += hours.be;
    total.workshop += hours.workshop;
    total.install += hours.install;
  }
  return {
    be: Math.round(total.be * 1_000_000) / 1_000_000,
    workshop: Math.round(total.workshop * 1_000_000) / 1_000_000,
    install: Math.round(total.install * 1_000_000) / 1_000_000,
  };
}

export function assertForecastQuoteSelection(
  caseId: string,
  quoteIds: readonly string[],
  quotes: readonly NativeQuoteRecord[],
): void {
  if (new Set(quoteIds).size !== quoteIds.length) {
    throw new Error("COMMERCIAL_FORECAST_QUOTE_DUPLICATE");
  }
  const byId = new Map(quotes.map((quote) => [quote.id, quote]));
  for (const id of quoteIds) {
    if (byId.get(id)?.commercialCaseId !== caseId) {
      throw new Error("COMMERCIAL_FORECAST_QUOTE_NOT_IN_AFFAIR");
    }
  }
}
