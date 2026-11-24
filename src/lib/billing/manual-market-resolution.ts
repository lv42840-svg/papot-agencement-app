import { createHash } from "node:crypto";
import type { BillingManualMarket, BillingPayload, BillingSource } from "./domain";
import { buildBillingSourceForChantier } from "./market-sources";

type ChantierIdentity = Parameters<typeof buildBillingSourceForChantier>[0];

export type ManualMarketResolution = {
  chantierId: string;
  manual: { description: string; amountHtCents: number; version: string };
  retainedQuotes: { id: string; label: string; amountHtCents: number }[];
  retainedVersion: string;
  blockedByDocuments: boolean;
};

const version = (values: readonly unknown[]) =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");

function hasBillingDependencies(
  payload: BillingPayload,
  manual: BillingManualMarket,
  quotes: BillingSource[],
) {
  const aliases = new Set([manual.chantierId, ...quotes.map((quote) => quote.quoteId)]);
  const sameLine = (line: { sourceLineId?: string | null; allocationLineId?: string | null }) =>
    line.sourceLineId === manual.lineId || line.allocationLineId === manual.lineId;
  if (
    payload.drafts.some(
      (draft) =>
        draft.chantierId === manual.chantierId ||
        aliases.has(draft.quoteId) ||
        draft.sourceQuoteIds?.some((id) => aliases.has(id)) ||
        draft.lines?.some((line) => line.lineId === manual.lineId) ||
        draft.lineProgress?.some((line) => line.lineId === manual.lineId) ||
        draft.structure?.some((item) => item.kind === "LINE" && item.lineId === manual.lineId) ||
        draft.documentLines?.some(sameLine),
    )
  )
    return true;
  if (
    payload.visaVersions?.some(
      (visa) => aliases.has(visa.draftId) || visa.documentLines.some(sameLine),
    )
  )
    return true;
  // If an invoice belongs to the site, keep its entire chain (credit notes,
  // payments, retention, and archived PDF) untouched, including simulations.
  const nativeInvoices = [
    ...(payload.nativeInvoiceLedger?.invoices ?? []),
    ...(payload.testSandbox?.invoiceLedger.invoices ?? []),
  ];
  if (
    nativeInvoices.some(
      (invoice) =>
        invoice.chantierId === manual.chantierId ||
        aliases.has(invoice.sourceQuoteId) ||
        aliases.has(invoice.draftId) ||
        invoice.documentLines.some(sameLine),
    )
  )
    return true;
  return Boolean(
    payload.financialLedger?.invoices.some(
      (invoice) => invoice.chantierId === manual.chantierId || aliases.has(invoice.draftId),
    ) ||
      payload.financialLedger?.closingDates.some(
        (entry) => entry.chantierId === manual.chantierId,
      ) ||
      payload.extras?.some((extra) => extra.lineId === manual.lineId),
  );
}

export function inspectManualMarketResolution(
  payload: BillingPayload,
  chantier: ChantierIdentity,
  quoteSources: readonly BillingSource[],
): ManualMarketResolution | null {
  const manuals = (payload.manualMarkets ?? []).filter(
    (market) => market.chantierId === chantier.id,
  );
  const quotes = quoteSources
    .filter((quote) => quote.chantierId === chantier.id)
    .sort((left, right) => left.quoteId.localeCompare(right.quoteId));
  if (manuals.length !== 1 || !quotes.length) return null;
  const manual = manuals[0];
  if (
    manual.commercialCaseId !== chantier.sourceCommercialCaseId ||
    quotes.some(
      (quote) =>
        quote.clientId !== manual.clientId || quote.commercialCaseId !== manual.commercialCaseId,
    )
  )
    return null;
  // The retained basis must be usable on its own. Do not remove anything if
  // doing so would merely reveal another inconsistency under the first one.
  try {
    if (!buildBillingSourceForChantier(chantier, quotes, [], payload.extras)) return null;
  } catch {
    return null;
  }
  return {
    chantierId: chantier.id,
    manual: {
      description: manual.description,
      amountHtCents: manual.amountHtCents,
      version: version([
        manual.lineId,
        manual.createdAt,
        manual.commercialCaseId,
        manual.clientId,
        manual.description,
        manual.amountHtCents,
        manual.vatRatePercent,
      ]),
    },
    retainedQuotes: quotes.map((quote) => ({
      id: quote.quoteId,
      label: quote.quoteLabel,
      amountHtCents: quote.contractHtCents,
    })),
    retainedVersion: version(
      quotes.map((quote) => [
        quote.quoteId,
        quote.commercialCaseId,
        quote.clientId,
        quote.quoteLabel,
        quote.contractHtCents,
        quote.contractTaxGroups,
        quote.lines,
        quote.structure,
      ]),
    ),
    blockedByDocuments: hasBillingDependencies(payload, manual, quotes),
  };
}

export function removeDuplicateManualMarket(
  payload: BillingPayload,
  chantier: ChantierIdentity,
  quoteSources: readonly BillingSource[],
  expected: { manualVersion: string; retainedVersion: string },
): BillingPayload {
  const resolution = inspectManualMarketResolution(payload, chantier, quoteSources);
  if (
    !resolution ||
    resolution.manual.version !== expected.manualVersion ||
    resolution.retainedVersion !== expected.retainedVersion
  )
    throw new Error("BILLING_MANUAL_MARKET_RESOLUTION_STALE");
  if (resolution.blockedByDocuments) throw new Error("BILLING_MANUAL_MARKET_HAS_DOCUMENTS");
  return {
    ...payload,
    manualMarkets: (payload.manualMarkets ?? []).filter(
      (market) => market.chantierId !== chantier.id,
    ),
  };
}
