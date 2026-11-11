import { commercialParisDateKey } from "./domain";
import type { QuoteStatus } from "@/lib/quotes/domain";

export type CommercialQuoteDisplayStatus = QuoteStatus | "FOLLOW_UP";

export const COMMERCIAL_QUOTE_STATUS_LABELS: Record<CommercialQuoteDisplayStatus, string> = {
  DRAFT: "Brouillon",
  FROZEN: "Validé",
  SENT: "Envoyé",
  FOLLOW_UP: "À relancer",
  ACCEPTED: "Accepté",
  REJECTED: "Refusé",
  CANCELLED: "Annulé",
  SUPERSEDED: "Version précédente",
};

export function commercialQuoteDisplayStatus(
  statutDevis: QuoteStatus,
  dateRelance: string | null,
  maintenant: Date = new Date(),
): CommercialQuoteDisplayStatus {
  if (statutDevis !== "SENT") return statutDevis;
  if (dateRelance && dateRelance <= commercialParisDateKey(maintenant)) return "FOLLOW_UP";
  return "SENT";
}

export function quoteEditorHref(idDevis: string): string {
  return `/devis/${encodeURIComponent(idDevis)}`;
}
