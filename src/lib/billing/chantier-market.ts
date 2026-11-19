import type { ChantierRecord } from "@/lib/chantiers/domain";
import type { BillingDraft, BillingSource, BillingManualMarket, BillingExtra } from "./domain";

type ChantierIdentity = Pick<ChantierRecord, "id" | "name" | "number" | "clientName" | "status">;

export type ChantierBillingMarket = {
  chantierId: string;
  chantierName: string;
  chantierNumber: string | null;
  clientName: string | null;
  status: ChantierRecord["status"];
  quoteCount: number;
  draftCount: number;
  confirmedExtraHtCents: number;
  pendingExtraHtCents: number;
  pendingExtraCount: number;
  contractHtCents: number;
  preparedHtCents: number;
  remainingToPrepareHtCents: number;
  preparationExceedsContract: boolean;
  requiresMarketEntry: boolean;
  quotes: Array<{ quoteId: string; label: string; amountHtCents: number }>;
};

function safeSum(values: readonly number[]): number {
  const total = values.reduce((amount, value) => amount + value, 0);
  if (!Number.isSafeInteger(total) || values.some((value) => !Number.isSafeInteger(value))) {
    throw new Error("BILLING_CHANTIER_MARKET_AMOUNT_INVALID");
  }
  return total;
}

/**
 * Read-only consolidated view of all eligible retained quotes of a chantier.
 * This is a preparation overview, NOT an issued-invoice ledger.
 * A chantier without a retained quote remains visible and needs its own market entry.
 */
export function summarizeChantierBillingMarkets(
  chantiers: readonly ChantierIdentity[],
  sources: readonly BillingSource[],
  drafts: readonly BillingDraft[],
  manualMarkets: readonly BillingManualMarket[] = [],
  extras: readonly BillingExtra[] = [],
): ChantierBillingMarket[] {
  return chantiers.map((chantier) => {
    const retained = sources.filter((source) => source.chantierId === chantier.id);
    if (new Set(retained.map((source) => source.quoteId)).size !== retained.length) {
      throw new Error("BILLING_CHANTIER_MARKET_QUOTE_DUPLICATE");
    }
    const prepared = drafts.filter((draft) => draft.chantierId === chantier.id);
    const manual = manualMarkets.find((item) => item.chantierId === chantier.id);
    const siteExtras = extras.filter((extra) => extra.chantierId === chantier.id);
    const confirmedExtras = siteExtras.filter((extra) => extra.agreementStatus === "CONFIRMED");
    const pendingExtras = siteExtras.filter((extra) => extra.agreementStatus === "TO_CONFIRM");
    const contractHtCents = safeSum([
      ...retained.map((source) => source.contractHtCents),
      ...(manual ? [manual.amountHtCents] : []),
      ...confirmedExtras.map((extra) => extra.amountHtCents),
    ]);
    const preparedHtCents = safeSum(prepared.map((draft) => draft.amountHtCents));
    return {
      chantierId: chantier.id,
      chantierName: chantier.name,
      chantierNumber: chantier.number,
      clientName: chantier.clientName,
      status: chantier.status,
      quoteCount: retained.length,
      draftCount: prepared.length,
      confirmedExtraHtCents: safeSum(confirmedExtras.map((extra) => extra.amountHtCents)),
      pendingExtraHtCents: safeSum(pendingExtras.map((extra) => extra.amountHtCents)),
      pendingExtraCount: pendingExtras.length,
      contractHtCents,
      preparedHtCents,
      remainingToPrepareHtCents: Math.max(0, contractHtCents - preparedHtCents),
      preparationExceedsContract: preparedHtCents > contractHtCents,
      requiresMarketEntry: retained.length === 0 && !manual,
      quotes: retained.map((source) => ({
        quoteId: source.quoteId,
        label: source.quoteLabel,
        amountHtCents: source.contractHtCents,
      })),
    };
  });
}
