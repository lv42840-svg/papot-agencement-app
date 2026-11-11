import { calculateQuoteAdjustedPricing } from "../quotes/adjustments";
import {
  quoteOuvrageComponentCostPriceCents,
  type QuoteLine,
  type QuoteOuvrageComponent,
} from "../quotes/model";
import type { NativeQuoteRecord } from "../quotes/store";

export type PlannedPurchaseLine = {
  quoteId: string;
  quoteReference: string;
  quoteLineId: string;
  componentId: string;
  quoteLineDescription: string;
  description: string;
  quantity: number;
  unit: string;
  unitCostCents: number | null;
  totalCostCents: number | null;
};

export type QuotePurchaseExtraction = {
  lines: PlannedPurchaseLine[];
  unclassified: {
    quoteLineId: string;
    description: string;
    reason: string;
  }[];
  totalCents: number | null;
};

/**
 * Extract purchases and external items from the retained quote version.
 * BE / ATELIER / POSE components are labor, never purchases.
 * Quoted cost adjustments (hotel, pass-through fees) are intentionally not
 * treated as purchasable materials. Unknown lines make the total incomplete.
 */
export function extractPlannedPurchases(devis: NativeQuoteRecord): QuotePurchaseExtraction {
  const tarification = calculateQuoteAdjustedPricing(devis.model.items, devis.pricingConfig);
  const lignesParId = new Map(
    devis.model.items
      .filter((element): element is QuoteLine => element.kind === "LINE")
      .map((ligne) => [ligne.id, ligne]),
  );
  const lignes: PlannedPurchaseLine[] = [];
  const nonClasses: QuotePurchaseExtraction["unclassified"] = [];
  const referenceDevis = devis.finalPdf?.quoteNumber ?? devis.model.subject;

  for (const ligneAjustee of tarification.lines) {
    if (ligneAjustee.optionStatus !== null && ligneAjustee.optionStatus !== "RETAINED") {
      continue;
    }
    const ligne = lignesParId.get(ligneAjustee.lineId);
    if (!ligne) continue;

    const composants: QuoteOuvrageComponent[] = ligne.components ?? [];
    if (composants.length === 0) {
      if (ligne.librarySource?.kind === "COMPONENT") {
        const source = ligne.librarySource.component;
        if (source.activity) continue;
        if (/^(h|hr|heure|heures)$/i.test(source.unit.trim())) {
          nonClasses.push({
            quoteLineId: ligne.id,
            description: ligne.description,
            reason: "Activité manquante sur un composant en heures",
          });
          continue;
        }
        lignes.push({
          quoteId: devis.id,
          quoteReference: referenceDevis,
          quoteLineId: ligne.id,
          componentId: source.sourceComponentId,
          quoteLineDescription: ligne.description,
          description: source.name,
          quantity: ligne.quantity,
          unit: source.unit,
          unitCostCents: source.costPriceCents,
          totalCostCents: Math.round(ligne.quantity * source.costPriceCents),
        });
      } else {
        nonClasses.push({
          quoteLineId: ligne.id,
          description: ligne.description,
          reason: "Aucun composant d'achat ou de main-d'œuvre renseigné",
        });
      }
      continue;
    }

    for (const composant of composants) {
      const activite = composant.activity ?? composant.librarySource?.component.activity ?? null;
      if (activite !== null) continue;
      if (/^(h|hr|heure|heures)$/i.test(composant.unit.trim())) {
        nonClasses.push({
          quoteLineId: ligne.id,
          description: composant.description,
          reason: "Activité manquante sur un composant en heures",
        });
        continue;
      }
      const coutUnitaireCentimes = quoteOuvrageComponentCostPriceCents(composant);
      const coutTotalCentimes =
        coutUnitaireCentimes === null
          ? null
          : Math.round(ligne.quantity * Math.round(composant.quantity * coutUnitaireCentimes));
      lignes.push({
        quoteId: devis.id,
        quoteReference: referenceDevis,
        quoteLineId: ligne.id,
        componentId: composant.id,
        quoteLineDescription: ligne.description,
        description: composant.description,
        quantity: ligne.quantity * composant.quantity,
        unit: composant.unit,
        unitCostCents: coutUnitaireCentimes,
        totalCostCents: coutTotalCentimes,
      });
    }
  }

  const complet = nonClasses.length === 0 && lignes.every((ligne) => ligne.totalCostCents !== null);
  return {
    lines: lignes,
    unclassified: nonClasses,
    totalCents: complet
      ? lignes.reduce((total, ligne) => total + (ligne.totalCostCents ?? 0), 0)
      : null,
  };
}
