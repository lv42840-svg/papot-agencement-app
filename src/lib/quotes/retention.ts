import type { CommercialStatus } from "../commercial/domain";
import {
  parseNativeQuotesPayload,
  type NativeQuoteRecord,
  type NativeQuotesPayload,
} from "./store";

export type QuoteContractSelectionState = "RETAINED" | "NOT_RETAINED" | null;

export type QuoteContractContext = {
  id: string;
  status: CommercialStatus;
  retainedQuoteIds: readonly string[];
};

export function quoteContractSelectionState(
  quote: NativeQuoteRecord,
  commercialCase: QuoteContractContext | null | undefined,
): QuoteContractSelectionState {
  if (!commercialCase || commercialCase.id !== quote.commercialCaseId) return null;
  if (commercialCase.status !== "CONFIRMED" || !quote.finalPdf) return null;
  return commercialCase.retainedQuoteIds.includes(quote.id) ? "RETAINED" : "NOT_RETAINED";
}

export function quoteContractSelectionLabel(
  state: Exclude<QuoteContractSelectionState, null>,
): string {
  return state === "RETAINED" ? "Retenu / contrat" : "Non retenu / classé";
}

export function quoteCanBeRetained(quote: NativeQuoteRecord): boolean {
  if (!quote.finalPdf) return false;
  return quote.status === "SENT" || quote.status === "ACCEPTED" || quote.status === "SUPERSEDED";
}

export function validateRetainedQuoteSelection(
  source: NativeQuotesPayload,
  commercialCaseId: string,
  retainedQuoteIds: readonly string[],
  confirmWithoutQuote: boolean,
): NativeQuoteRecord[] {
  const payload = parseNativeQuotesPayload(source);
  if (new Set(retainedQuoteIds).size !== retainedQuoteIds.length) {
    throw new Error("COMMERCIAL_RETAINED_QUOTE_DUPLICATE");
  }

  const caseQuotes = payload.quotes.filter((quote) => quote.commercialCaseId === commercialCaseId);
  const selectable = caseQuotes.filter(quoteCanBeRetained);
  const selectableIds = new Set(selectable.map((quote) => quote.id));

  if (retainedQuoteIds.some((quoteId) => !selectableIds.has(quoteId))) {
    throw new Error("COMMERCIAL_RETAINED_QUOTE_INVALID");
  }

  if (retainedQuoteIds.length === 0) {
    if (selectable.length > 0) throw new Error("COMMERCIAL_QUOTE_SELECTION_REQUIRED");
    if (!confirmWithoutQuote) throw new Error("COMMERCIAL_CONFIRM_WITHOUT_QUOTE_REQUIRED");
  }

  return retainedQuoteIds.map((quoteId) => selectable.find((quote) => quote.id === quoteId)!);
}

export function validateAdditionalRetainedQuote(
  source: NativeQuotesPayload,
  commercialCaseId: string,
  quoteId: string,
): NativeQuoteRecord {
  const payload = parseNativeQuotesPayload(source);
  const quote = payload.quotes.find(
    (candidate) => candidate.id === quoteId && candidate.commercialCaseId === commercialCaseId,
  );
  if (!quote || !quoteCanBeRetained(quote)) {
    throw new Error("COMMERCIAL_RETAINED_QUOTE_INVALID");
  }
  return quote;
}
