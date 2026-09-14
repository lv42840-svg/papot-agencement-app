import { commercialParisDateKey, type CommercialCase } from "./domain";
import type { QuoteStatus } from "@/lib/quotes/domain";

export type CommercialQuoteDisplayStatus = QuoteStatus | "FOLLOW_UP";

export const COMMERCIAL_QUOTE_STATUS_LABELS: Record<CommercialQuoteDisplayStatus, string> = {
  DRAFT: "Brouillon",
  SENT: "Envoyé",
  FOLLOW_UP: "À relancer",
  ACCEPTED: "Accepté",
  REJECTED: "Refusé",
  CANCELLED: "Annulé",
};

export function commercialQuoteDisplayStatus(
  quoteStatus: QuoteStatus,
  affair: Pick<CommercialCase, "status" | "reviewDate">,
  now: Date = new Date(),
): CommercialQuoteDisplayStatus {
  if (quoteStatus !== "SENT") return quoteStatus;
  if (affair.status === "FOLLOW_UP") return "FOLLOW_UP";
  if (
    affair.status === "WAITING" &&
    affair.reviewDate &&
    affair.reviewDate <= commercialParisDateKey(now)
  ) {
    return "FOLLOW_UP";
  }
  return "SENT";
}

export function quoteEditorHref(quoteId: string): string {
  return `/devis/${encodeURIComponent(quoteId)}`;
}
