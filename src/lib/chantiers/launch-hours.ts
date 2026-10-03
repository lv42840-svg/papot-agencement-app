import type { ChantierHours } from "./domain";
import { calculateCommercialContractSummary } from "../quotes/commercial-summary";
import type { NativeQuotesPayload } from "../quotes/store";

export type ChantierLaunchHoursSource = "RETAINED_QUOTES" | "COMMERCIAL_PROVISION";

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
  affair: LaunchHoursAffair,
  quotes: NativeQuotesPayload,
): ChantierLaunchHours {
  if (affair.retainedQuoteIds.length === 0) {
    return {
      hours: { ...affair.provisionHours },
      source: "COMMERCIAL_PROVISION",
    };
  }

  const quotesById = new Map(quotes.quotes.map((quote) => [quote.id, quote]));
  const retainedQuotes = affair.retainedQuoteIds.map((quoteId) => {
    const quote = quotesById.get(quoteId);
    if (!quote || quote.commercialCaseId !== affair.id) {
      throw new Error("CHANTIER_RETAINED_QUOTE_NOT_FOUND");
    }
    return quote;
  });

  const contract = calculateCommercialContractSummary(retainedQuotes, affair.retainedQuoteIds);
  return {
    hours: {
      be: contract.soldHoursByActivity.be,
      workshop: contract.soldHoursByActivity.workshop,
      install: contract.soldHoursByActivity.install,
    },
    source: "RETAINED_QUOTES",
  };
}
