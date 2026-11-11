import "server-only";

import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import { createClientsRepository } from "@/lib/clients/create-repository";
import { clientDisplayName } from "@/lib/clients/domain";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { calculateQuoteAdjustedPricing } from "@/lib/quotes/adjustments";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import { quoteCanBeRetained } from "@/lib/quotes/retention";
import type { NativeQuoteRecord } from "@/lib/quotes/store";
import {
  billingSourceSchema,
  type BillingSource,
  type BillingTaxGroup,
  type BillingSourceLine,
} from "./domain";

function quoteContractData(quote: NativeQuoteRecord): {
  taxGroups: BillingTaxGroup[];
  lines: BillingSourceLine[];
} {
  const prix = calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig);
  if (prix.warnings.length > 0) throw new Error("BILLING_QUOTE_PRICING_REVIEW_REQUIRED");
  const rates = new Map(
    quote.taxConfig.lineOverrides.map((element) => [element.lineId, element.ratePercent]),
  );
  const byLineId = new Map(
    quote.model.items
      .filter((element) => element.kind === "LINE")
      .map((element) => [element.id, element]),
  );
  const lignes: BillingSourceLine[] = prix.lines
    .filter((ligne) => ligne.optionStatus !== "PENDING" && ligne.optionStatus !== "REJECTED")
    .map((ligne) => ({
      lineId: ligne.lineId,
      description: ligne.description,
      amountHtCents: ligne.saleCents,
      vatRatePercent: rates.get(ligne.lineId) ?? quote.taxConfig.defaultRatePercent,
      quantity: byLineId.get(ligne.lineId)?.quantity ?? 1,
      unit: byLineId.get(ligne.lineId)?.unit ?? "u",
    }));
  const byRate = new Map<number, number>();
  for (const ligne of lignes) {
    byRate.set(ligne.vatRatePercent, (byRate.get(ligne.vatRatePercent) ?? 0) + ligne.amountHtCents);
  }
  const total = [...byRate.values()].reduce((somme, montant) => somme + montant, 0);
  if (total <= 0 || total !== prix.totalSaleCents) {
    throw new Error("BILLING_QUOTE_PRICING_MISMATCH");
  }
  return {
    lines: lignes,
    taxGroups: [...byRate.entries()]
      .map(([ratePercent, baseHtCents]) => ({ ratePercent, baseHtCents }))
      .sort((a, b) => a.ratePercent - b.ratePercent),
  };
}

export async function loadBillingSources(): Promise<BillingSource[]> {
  const [quotes, commercial, clients, chantiers] = await Promise.all([
    createQuotesRepository().load(),
    createCommercialRepository().load(),
    (await createClientsRepository()).load(),
    createChantiersRepository().load(),
  ]);
  const byClient = new Map(clients.clients.map((client) => [client.id, client]));
  const byAffair = new Map(commercial.cases.map((affair) => [affair.id, affair]));
  const byAffairChantier = new Map(
    chantiers.chantiers.map((chantier) => [chantier.sourceCommercialCaseId, chantier]),
  );

  return quotes.quotes
    .flatMap((quote): BillingSource[] => {
      const affair = byAffair.get(quote.commercialCaseId);
      if (
        !affair ||
        affair.status !== "CONFIRMED" ||
        !affair.retainedQuoteIds.includes(quote.id) ||
        !quoteCanBeRetained(quote)
      )
        return [];
      if (!affair.clientId || affair.clientId !== quote.model.clientId) return [];
      const client = byClient.get(affair.clientId);
      if (!client) return [];

      try {
        const { taxGroups, lines: lignes } = quoteContractData(quote);
        const chantier = byAffairChantier.get(affair.id) ?? null;
        return [
          billingSourceSchema.parse({
            quoteId: quote.id,
            commercialCaseId: affair.id,
            chantierId: chantier?.id ?? null,
            clientId: client.id,
            clientName: clientDisplayName(client),
            affairName: affair.name,
            quoteLabel:
              quote.finalPdf?.quoteNumber ?? `${quote.variantName} · version ${quote.version}`,
            contractHtCents: taxGroups.reduce((somme, group) => somme + group.baseHtCents, 0),
            contractTaxGroups: taxGroups,
            lines: lignes,
          }),
        ];
      } catch {
        // Do not invoice a quote whose pricing needs review. It remains editable in Quotes.
        return [];
      }
    })
    .sort(
      (a, b) =>
        a.affairName.localeCompare(b.affairName, "fr-FR") ||
        a.quoteLabel.localeCompare(b.quoteLabel, "fr-FR"),
    );
}
