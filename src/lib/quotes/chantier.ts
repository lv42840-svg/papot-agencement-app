import type { CommercialStatus } from "@/lib/commercial/domain";
import { parseNativeQuotesPayload, type NativeQuotesPayload } from "./store";

function sameVariant(gauche: string, droite: string): boolean {
  return gauche.localeCompare(droite, "fr-FR", { sensitivity: "base" }) === 0;
}

export function nextChantierComplementVariantName(
  source: NativeQuotesPayload,
  commercialCaseId: string,
): string {
  const contenu = parseNativeQuotesPayload(source);
  const existing = contenu.quotes
    .filter((quote) => quote.commercialCaseId === commercialCaseId)
    .map((quote) => quote.variantName);

  let indice = 1;
  while (indice < 10_000) {
    const candidat = `Complément ${indice}`;
    if (!existing.some((nom) => sameVariant(nom, candidat))) return candidat;
    indice += 1;
  }

  throw new Error("QUOTE_COMPLEMENT_NAME_UNAVAILABLE");
}

export function quoteWorkflowMayChangeCommercialStatus(statut: CommercialStatus): boolean {
  return statut !== "CONFIRMED";
}
