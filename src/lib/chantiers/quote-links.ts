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

function quoteNumber(devis: NativeQuoteRecord): string {
  return devis.finalPdf?.quoteNumber ?? `${devis.variantName} · V${devis.version}`;
}

function lineReference(devis: NativeQuoteRecord, ligne: QuoteLine): ChantierQuoteLineReference {
  return {
    quoteId: devis.id,
    quoteLineId: ligne.id,
    quoteNumber: quoteNumber(devis),
    quoteKind: devis.quoteKind,
    variantName: devis.variantName,
    version: devis.version,
    subject: devis.model.subject,
    description: ligne.description,
    unit: ligne.unit,
    quantity: ligne.quantity,
  };
}

export function retainedChantierQuotes(
  affaire: CommercialCase,
  source: NativeQuotesPayload,
): ChantierRetainedQuote[] {
  const donnees = parseNativeQuotesPayload(source);
  const identifiantsRetenus = new Set(affaire.retainedQuoteIds);

  return donnees.quotes
    .filter((devis) => devis.commercialCaseId === affaire.id && identifiantsRetenus.has(devis.id))
    .map((devis) => ({
      quote: devis,
      lines: devis.model.items
        .filter((element): element is QuoteLine => element.kind === "LINE")
        .map((ligne) => lineReference(devis, ligne)),
    }));
}

export function retainedChantierQuoteLines(
  affaire: CommercialCase,
  source: NativeQuotesPayload,
): ChantierQuoteLineReference[] {
  return retainedChantierQuotes(affaire, source).flatMap((entree) => entree.lines);
}

export function resolveRetainedChantierQuoteLine(
  affaire: CommercialCase,
  source: NativeQuotesPayload,
  idDevis: string,
  idLigneDevis: string,
): ChantierQuoteLineReference {
  const reference = retainedChantierQuoteLines(affaire, source).find(
    (candidat) => candidat.quoteId === idDevis && candidat.quoteLineId === idLigneDevis,
  );
  if (!reference) {
    throw new Error("CHANTIER_QUOTE_LINE_INVALID");
  }
  return reference;
}

export function chantierQuoteLineDisplay(reference: ChantierQuoteLineReference): string {
  return `${reference.quoteNumber} · ${reference.description}`;
}
