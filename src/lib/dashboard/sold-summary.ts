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
  affaires: readonly CommercialCase[],
  devis: readonly NativeQuoteRecord[],
  maintenant = new Date(),
): DashboardSoldSummary {
  const parties = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(maintenant);
  const annee = parties.find((partie) => partie.type === "year")?.value ?? "";
  const mois = annee + "-" + (parties.find((partie) => partie.type === "month")?.value ?? "");
  const devisParId = new Map(devis.map((unDevis) => [unDevis.id, unDevis]));
  const formatDateParis = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  function pourPeriode(periode: string): SoldPeriodSummary {
    let venduCentimes = 0;
    let margePrevueCentimes = 0;
    let venduComplet = true;
    let margeComplete = true;
    let affairesConfirmees = 0;
    let affairesIncompletes = 0;

    for (const affaire of affaires) {
      if (affaire.status !== "CONFIRMED" || !affaire.confirmedAt) continue;
      const partiesDate = formatDateParis.formatToParts(new Date(affaire.confirmedAt));
      const valeursDate = Object.fromEntries(
        partiesDate.map((partie) => [partie.type, partie.value]),
      );
      const date = valeursDate.year + "-" + valeursDate.month + "-" + valeursDate.day;
      if (!date.startsWith(periode)) continue;
      affairesConfirmees += 1;

      const devisRetenus = affaire.retainedQuoteIds.map((id) => devisParId.get(id));
      if (
        devisRetenus.length === 0 ||
        devisRetenus.some((unDevis) => !unDevis || unDevis.commercialCaseId !== affaire.id)
      ) {
        venduComplet = false;
        margeComplete = false;
        affairesIncompletes += 1;
        continue;
      }

      const resume = calculateCommercialContractSummary(
        devisRetenus.filter((unDevis): unDevis is NativeQuoteRecord => Boolean(unDevis)),
        affaire.retainedQuoteIds,
      );
      venduCentimes += resume.totalHtCents;
      if (resume.plannedMarginCents === null) {
        margeComplete = false;
      } else {
        margePrevueCentimes += resume.plannedMarginCents;
      }
    }

    return {
      soldCents: venduComplet ? venduCentimes : null,
      plannedMarginCents: margeComplete && venduComplet ? margePrevueCentimes : null,
      confirmedCases: affairesConfirmees,
      incompleteCases: affairesIncompletes,
    };
  }

  return {
    year: annee,
    month: mois,
    yearly: pourPeriode(annee),
    monthly: pourPeriode(mois),
  };
}
