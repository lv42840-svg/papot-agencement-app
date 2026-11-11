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
  devis: NativeQuoteRecord,
  affaireCommerciale: QuoteContractContext | null | undefined,
): QuoteContractSelectionState {
  if (!affaireCommerciale || affaireCommerciale.id !== devis.commercialCaseId) {
    return null;
  }
  if (affaireCommerciale.status !== "CONFIRMED" || !devis.finalPdf) return null;
  return affaireCommerciale.retainedQuoteIds.includes(devis.id) ? "RETAINED" : "NOT_RETAINED";
}

export function quoteContractSelectionLabel(
  etat: Exclude<QuoteContractSelectionState, null>,
): string {
  return etat === "RETAINED" ? "Retenu / contrat" : "Non retenu / classé";
}

export function quoteCanBeRetained(devis: NativeQuoteRecord): boolean {
  if (!devis.finalPdf) return false;
  return devis.status === "SENT" || devis.status === "ACCEPTED" || devis.status === "SUPERSEDED";
}

export function validateRetainedQuoteSelection(
  source: NativeQuotesPayload,
  idAffaireCommerciale: string,
  identifiantsDevisRetenus: readonly string[],
  confirmerSansDevis: boolean,
): NativeQuoteRecord[] {
  const donnees = parseNativeQuotesPayload(source);
  if (new Set(identifiantsDevisRetenus).size !== identifiantsDevisRetenus.length) {
    throw new Error("COMMERCIAL_RETAINED_QUOTE_DUPLICATE");
  }

  const devisAffaire = donnees.quotes.filter(
    (devis) => devis.commercialCaseId === idAffaireCommerciale,
  );
  const devisSelectionnables = devisAffaire.filter(quoteCanBeRetained);
  const identifiantsSelectionnables = new Set(devisSelectionnables.map((devis) => devis.id));

  if (identifiantsDevisRetenus.some((idDevis) => !identifiantsSelectionnables.has(idDevis))) {
    throw new Error("COMMERCIAL_RETAINED_QUOTE_INVALID");
  }

  if (identifiantsDevisRetenus.length === 0) {
    if (devisSelectionnables.length > 0) {
      throw new Error("COMMERCIAL_QUOTE_SELECTION_REQUIRED");
    }
    if (!confirmerSansDevis) {
      throw new Error("COMMERCIAL_CONFIRM_WITHOUT_QUOTE_REQUIRED");
    }
  }

  return identifiantsDevisRetenus.map(
    (idDevis) => devisSelectionnables.find((devis) => devis.id === idDevis)!,
  );
}

export function validateAdditionalRetainedQuote(
  source: NativeQuotesPayload,
  idAffaireCommerciale: string,
  idDevis: string,
): NativeQuoteRecord {
  const donnees = parseNativeQuotesPayload(source);
  const devis = donnees.quotes.find(
    (candidat) => candidat.id === idDevis && candidat.commercialCaseId === idAffaireCommerciale,
  );
  if (!devis || !quoteCanBeRetained(devis)) {
    throw new Error("COMMERCIAL_RETAINED_QUOTE_INVALID");
  }
  return devis;
}
