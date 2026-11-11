import type { CommercialCase } from "./domain";
import { calculateCommercialQuoteSummary } from "../quotes/commercial-summary";
import type { NativeQuoteRecord } from "../quotes/store";

export type ForecastActivityHours = { be: number; workshop: number; install: number };

export function effectiveCommercialForecastHours(
  affaire: Pick<CommercialCase, "provisionHours" | "forecastQuoteIds" | "id">,
  devis: readonly NativeQuoteRecord[],
): ForecastActivityHours {
  // null means legacy/manual mode, including all existing commercial cases.
  if (affaire.forecastQuoteIds == null) return affaire.provisionHours;
  const identifiantsDevis = new Set(affaire.forecastQuoteIds);
  const total = { be: 0, workshop: 0, install: 0 };
  for (const unDevis of devis) {
    if (!identifiantsDevis.has(unDevis.id) || unDevis.commercialCaseId !== affaire.id) continue;
    const heures = calculateCommercialQuoteSummary(unDevis).soldHoursByActivity;
    total.be += heures.be;
    total.workshop += heures.workshop;
    total.install += heures.install;
  }
  return {
    be: Math.round(total.be * 1_000_000) / 1_000_000,
    workshop: Math.round(total.workshop * 1_000_000) / 1_000_000,
    install: Math.round(total.install * 1_000_000) / 1_000_000,
  };
}

export function assertForecastQuoteSelection(
  idAffaire: string,
  identifiantsDevis: readonly string[],
  devis: readonly NativeQuoteRecord[],
): void {
  if (new Set(identifiantsDevis).size !== identifiantsDevis.length) {
    throw new Error("COMMERCIAL_FORECAST_QUOTE_DUPLICATE");
  }
  const devisParId = new Map(devis.map((unDevis) => [unDevis.id, unDevis]));
  for (const idDevis of identifiantsDevis) {
    if (devisParId.get(idDevis)?.commercialCaseId !== idAffaire) {
      throw new Error("COMMERCIAL_FORECAST_QUOTE_NOT_IN_AFFAIR");
    }
  }
}
