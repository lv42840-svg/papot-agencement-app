import type { CommercialCase } from "../commercial/domain";
import type { QuoteLine } from "../quotes/model";
import {
  parseNativeQuotesPayload,
  type NativeQuoteRecord,
  type NativeQuotesPayload,
} from "../quotes/store";

export type ChantierQuoteLineReference = {
  quoteId: string;
  quoteLineId: string;
  quoteNumber: string;
  quoteKind: NativeQuoteRecord["quoteKind"];
  variantName: string;
  version: number;
  subject: string;
  description: string;
  unit: string;
  quantity: number;
};

export type ChantierRetainedQuote = {
  quote: NativeQuoteRecord;
  lines: ChantierQuoteLineReference[];
};

function quoteNumber(quote: NativeQuoteRecord): string {
  return quote.finalPdf?.quoteNumber ?? `${quote.variantName} · V${quote.version}`;
}

function lineReference(quote: NativeQuoteRecord, line: QuoteLine): ChantierQuoteLineReference {
  return {
    quoteId: quote.id,
    quoteLineId: line.id,
    quoteNumber: quoteNumber(quote),
    quoteKind: quote.quoteKind,
    variantName: quote.variantName,
    version: quote.version,
    subject: quote.model.subject,
    description: line.description,
    unit: line.unit,
    quantity: line.quantity,
  };
}

export function retainedChantierQuotes(
  affair: CommercialCase,
  source: NativeQuotesPayload,
): ChantierRetainedQuote[] {
  const payload = parseNativeQuotesPayload(source);
  const retainedIds = new Set(affair.retainedQuoteIds);

  return payload.quotes
    .filter((quote) => quote.commercialCaseId === affair.id && retainedIds.has(quote.id))
    .map((quote) => ({
      quote,
      lines: quote.model.items
        .filter((item): item is QuoteLine => item.kind === "LINE")
        .map((line) => lineReference(quote, line)),
    }));
}

export function retainedChantierQuoteLines(
  affair: CommercialCase,
  source: NativeQuotesPayload,
): ChantierQuoteLineReference[] {
  return retainedChantierQuotes(affair, source).flatMap((entry) => entry.lines);
}

export function resolveRetainedChantierQuoteLine(
  affair: CommercialCase,
  source: NativeQuotesPayload,
  quoteId: string,
  quoteLineId: string,
): ChantierQuoteLineReference {
  const reference = retainedChantierQuoteLines(affair, source).find(
    (candidate) => candidate.quoteId === quoteId && candidate.quoteLineId === quoteLineId,
  );
  if (!reference) throw new Error("CHANTIER_QUOTE_LINE_INVALID");
  return reference;
}

export function chantierQuoteLineDisplay(reference: ChantierQuoteLineReference): string {
  return `${reference.quoteNumber} · ${reference.description}`;
}
