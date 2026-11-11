import type { ChantierHours } from "./domain";
import { calculateCommercialContractSummary } from "../quotes/commercial-summary";
import type { NativeQuotesPayload } from "../quotes/store";

export type ChantierLaunchHoursSource =
  | "RETAINED_QUOTES"
  | "COMMERCIAL_PROVISION";

export type ChantierLaunchHours = {
  hours: ChantierHours;
  source: ChantierLaunchHoursSource;
};

type LaunchHoursAffair = {
  id: string;
  retainedQuoteIds: readonly string[];
  provisionHours: ChantierHours;
};

export function deriveChantierLaunchHours(
  affaire: LaunchHoursAffair,
  devis: NativeQuotesPayload,
): ChantierLaunchHours {
  if (affaire.retainedQuoteIds.length === 0) {
    return {
      hours: { ...affaire.provisionHours },
      source: "COMMERCIAL_PROVISION",
    };
  }

  const devisParId = new Map(
    devis.quotes.map((unDevis) => [unDevis.id, unDevis]),
  );
  const devisRetenus = affaire.retainedQuoteIds.map(
    (idDevis) => {
      const unDevis = devisParId.get(idDevis);
      if (
        !unDevis ||
        unDevis.commercialCaseId !== affaire.id
      ) {
        throw new Error(
          "CHANTIER_RETAINED_QUOTE_NOT_FOUND",
        );
      }
      return unDevis;
    },
  );

  const contrat = calculateCommercialContractSummary(
    devisRetenus,
    affaire.retainedQuoteIds,
  );
  return {
    hours: {
      be: contrat.soldHoursByActivity.be,
      workshop: contrat.soldHoursByActivity.workshop,
      install: contrat.soldHoursByActivity.install,
    },
    source: "RETAINED_QUOTES",
  };
}
