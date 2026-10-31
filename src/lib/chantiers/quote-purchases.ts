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
  unclassified: { quoteLineId: string; description: string; reason: string }[];
  totalCents: number | null;
};

/**
 * Extract purchases and external items from the retained quote version.
 * BE / ATELIER / POSE components are labor, never purchases.
 * Quoted cost adjustments (hotel, pass-through fees) are intentionally not
 * treated as purchasable materials. Unknown lines make the total incomplete.
 */
export function extractPlannedPurchases(quote: NativeQuoteRecord): QuotePurchaseExtraction {
  const pricing = calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig);
  const byLineId = new Map(
    quote.model.items
      .filter((item): item is QuoteLine => item.kind === "LINE")
      .map((line) => [line.id, line]),
  );
  const lines: PlannedPurchaseLine[] = [];
  const unclassified: QuotePurchaseExtraction["unclassified"] = [];
  const quoteReference = quote.finalPdf?.quoteNumber ?? quote.model.subject;

  for (const adjusted of pricing.lines) {
    if (adjusted.optionStatus !== null && adjusted.optionStatus !== "RETAINED") continue;
    const line = byLineId.get(adjusted.lineId);
    if (!line) continue;

    const components: QuoteOuvrageComponent[] = line.components ?? [];
    // A direct library component does not always create nested ouvrage components.
    if (components.length === 0) {
      if (line.librarySource?.kind === "COMPONENT") {
        const source = line.librarySource.component;
        if (source.activity) continue;
        if (/^(h|hr|heure|heures)$/i.test(source.unit.trim())) {
          unclassified.push({
            quoteLineId: line.id,
            description: line.description,
            reason: "Activité manquante sur un composant en heures",
          });
          continue;
        }
        lines.push({
          quoteId: quote.id,
          quoteReference,
          quoteLineId: line.id,
          componentId: source.sourceComponentId,
          quoteLineDescription: line.description,
          description: source.name,
          quantity: line.quantity,
          unit: source.unit,
          unitCostCents: source.costPriceCents,
          totalCostCents: Math.round(line.quantity * source.costPriceCents),
        });
      } else {
        unclassified.push({
          quoteLineId: line.id,
          description: line.description,
          reason: "Aucun composant d'achat ou de main-d'œuvre renseigné",
        });
      }
      continue;
    }

    for (const component of components) {
      const activity = component.activity ?? component.librarySource?.component.activity ?? null;
      if (activity !== null) continue;
      if (/^(h|hr|heure|heures)$/i.test(component.unit.trim())) {
        unclassified.push({
          quoteLineId: line.id,
          description: component.description,
          reason: "Activité manquante sur un composant en heures",
        });
        continue;
      }
      const unitCostCents = quoteOuvrageComponentCostPriceCents(component);
      const totalCostCents =
        unitCostCents === null
          ? null
          : Math.round(line.quantity * Math.round(component.quantity * unitCostCents));
      lines.push({
        quoteId: quote.id,
        quoteReference,
        quoteLineId: line.id,
        componentId: component.id,
        quoteLineDescription: line.description,
        description: component.description,
        quantity: line.quantity * component.quantity,
        unit: component.unit,
        unitCostCents,
        totalCostCents,
      });
    }
  }

  const complete = unclassified.length === 0 && lines.every((line) => line.totalCostCents !== null);
  return {
    lines,
    unclassified,
    totalCents: complete
      ? lines.reduce((total, line) => total + (line.totalCostCents ?? 0), 0)
      : null,
  };
}
