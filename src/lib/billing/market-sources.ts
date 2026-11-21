import type { ChantierRecord } from "@/lib/chantiers/domain";
import type {
  BillingManualMarket,
  BillingExtra,
  BillingSource,
  BillingSourceLine,
  BillingSourceStructureItem,
  BillingTaxGroup,
} from "./domain";

type ChantierIdentity = Pick<
  ChantierRecord,
  "id" | "sourceCommercialCaseId" | "name" | "clientName"
>;

function checkedSum(values: number[]): number {
  const sum = values.reduce((total, amount) => total + amount, 0);
  if (!Number.isSafeInteger(sum) || sum <= 0) {
    throw new Error("BILLING_MARKET_AMOUNT_INVALID");
  }
  return sum;
}

/**
 * Produces one billable contract per chantier. A stable synthetic contract ID
 * equal to chantier.id keeps old draft UUIDs valid and avoids a destructive migration.
 * Its sourceQuoteIds and line.sourceQuoteId retain the signed quote provenance.
 */
export function buildChantierMarketSources(
  chantiers: readonly ChantierIdentity[],
  quoteSources: readonly BillingSource[],
  manualMarkets: readonly BillingManualMarket[],
  extras: readonly BillingExtra[] = [],
): BillingSource[] {
  const markets: BillingSource[] = [];
  const configured = new Set<string>();
  for (const manual of manualMarkets) {
    if (configured.has(manual.chantierId)) throw new Error("BILLING_MARKET_DUPLICATE");
    configured.add(manual.chantierId);
  }

  for (const chantier of chantiers) {
    const quotes = quoteSources.filter((source) => source.chantierId === chantier.id);
    const manual = manualMarkets.find((item) => item.chantierId === chantier.id);
    if (quotes.length && manual) throw new Error("BILLING_MARKET_SOURCE_CONFLICT");
    if (!quotes.length && !manual) continue;

    if (!quotes.length && manual) {
      if (manual.commercialCaseId !== chantier.sourceCommercialCaseId) {
        throw new Error("BILLING_MARKET_CLIENT_MISMATCH");
      }
      markets.push({
        quoteId: chantier.id,
        sourceMode: "CHANTIER",
        sourceQuoteIds: [],
        commercialCaseId: chantier.sourceCommercialCaseId,
        chantierId: chantier.id,
        clientId: manual.clientId,
        clientName: manual.clientName,
        affairName: chantier.name,
        quoteLabel: "Marché sans devis",
        contractHtCents: manual.amountHtCents,
        contractTaxGroups: [
          { ratePercent: manual.vatRatePercent, baseHtCents: manual.amountHtCents },
        ],
        lines: [
          {
            lineId: manual.lineId,
            description: manual.description,
            amountHtCents: manual.amountHtCents,
            vatRatePercent: manual.vatRatePercent,
            quantity: 1,
            unit: "forfait",
          },
        ],
        structure: [
          { kind: "TITLE", title: "Marché sans devis", level: "SECTION" },
          { kind: "LINE", lineId: manual.lineId },
        ],
      });
      continue;
    }

    const clientId = quotes[0].clientId;
    if (
      quotes.some(
        (source) =>
          source.clientId !== clientId ||
          source.commercialCaseId !== chantier.sourceCommercialCaseId,
      )
    ) {
      throw new Error("BILLING_MARKET_CLIENT_MISMATCH");
    }

    const lines: BillingSourceLine[] = [];
    const structure: BillingSourceStructureItem[] = [];
    const taxBase = new Map<number, number>();
    const lineIds = new Set<string>();
    for (const quote of quotes) {
      structure.push({ kind: "TITLE", title: quote.quoteLabel, level: "SECTION" });
      for (const item of quote.structure ?? []) structure.push(item);
      for (const line of quote.lines ?? []) {
        if (lineIds.has(line.lineId)) throw new Error("BILLING_MARKET_LINE_DUPLICATE");
        lineIds.add(line.lineId);
        lines.push({ ...line, sourceQuoteId: quote.quoteId });
      }
      // Older quote sources might not expose a hierarchy: preserve their line order.
      if (!quote.structure?.length) {
        for (const line of quote.lines ?? []) structure.push({ kind: "LINE", lineId: line.lineId });
      }
      for (const tax of quote.contractTaxGroups) {
        taxBase.set(tax.ratePercent, (taxBase.get(tax.ratePercent) ?? 0) + tax.baseHtCents);
      }
    }
    if (lines.length > 1000 || structure.length > 1000) {
      throw new Error("BILLING_MARKET_LINES_LIMIT");
    }
    const contractTaxGroups: BillingTaxGroup[] = [...taxBase]
      .map(([ratePercent, baseHtCents]) => ({ ratePercent, baseHtCents }))
      .sort((a, b) => a.ratePercent - b.ratePercent);
    markets.push({
      quoteId: chantier.id,
      sourceMode: "CHANTIER",
      sourceQuoteIds: quotes.map((quote) => quote.quoteId),
      commercialCaseId: chantier.sourceCommercialCaseId,
      chantierId: chantier.id,
      clientId,
      clientName: quotes[0].clientName,
      affairName: chantier.name,
      quoteLabel: `Marché global (${quotes.length} devis)`,
      contractHtCents: checkedSum(quotes.map((quote) => quote.contractHtCents)),
      contractTaxGroups,
      lines,
      structure,
    });
  }
  return markets.map((market) => {
    const confirmed = extras.filter(
      (extra) => extra.chantierId === market.chantierId && extra.agreementStatus === "CONFIRMED",
    );
    if (!confirmed.length) return market;

    const lineIds = new Set((market.lines ?? []).map((line) => line.lineId));
    if (confirmed.some((extra) => lineIds.has(extra.lineId))) {
      throw new Error("BILLING_MARKET_LINE_DUPLICATE");
    }
    const newLines: BillingSourceLine[] = confirmed.map((extra) => ({
      lineId: extra.lineId,
      description: extra.description,
      amountHtCents: extra.amountHtCents,
      vatRatePercent: extra.vatRatePercent,
      quantity: 1,
      unit: "forfait",
    }));
    const structure: BillingSourceStructureItem[] = [
      ...(market.structure ?? []),
      { kind: "TITLE", title: "Travaux supplémentaires confirmés", level: "SECTION" },
      ...confirmed.map((extra) => ({ kind: "LINE" as const, lineId: extra.lineId })),
    ];
    const lines = [...(market.lines ?? []), ...newLines];
    if (lines.length > 1000 || structure.length > 1000) {
      throw new Error("BILLING_MARKET_LINES_LIMIT");
    }

    const taxBase = new Map(
      market.contractTaxGroups.map((group) => [group.ratePercent, group.baseHtCents]),
    );
    for (const extra of confirmed) {
      taxBase.set(
        extra.vatRatePercent,
        (taxBase.get(extra.vatRatePercent) ?? 0) + extra.amountHtCents,
      );
    }
    return {
      ...market,
      contractHtCents: checkedSum([
        market.contractHtCents,
        ...confirmed.map((extra) => extra.amountHtCents),
      ]),
      contractTaxGroups: [...taxBase.entries()]
        .map(([ratePercent, baseHtCents]) => ({ ratePercent, baseHtCents }))
        .sort((a, b) => a.ratePercent - b.ratePercent),
      lines,
      structure,
    };
  });
}
