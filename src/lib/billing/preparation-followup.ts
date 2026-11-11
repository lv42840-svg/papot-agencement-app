import type { BillingDraft, BillingSource } from "./domain";

export type BillingPreparationStatus = "NONE" | "PARTIAL" | "FULL";
export type BillingPreparationRow = {
  source: BillingSource;
  projectCount: number;
  preparedHtCents: number;
  remainingToPrepareHtCents: number;
  status: BillingPreparationStatus;
};

/**
 * Amounts here are preparation progress, NOT actual issued invoices.
 * Never infer a paid/issued status from an APPROVED internal project.
 * Deposits and progress documents are increments in BillingDraft.amountHtCents,
 * so summing each stored document once avoids cumulative double-counting.
 */
export function billingPreparationFollowup(
  sources: readonly BillingSource[],
  projets: readonly BillingDraft[],
): BillingPreparationRow[] {
  return sources.map((source) => {
    const projetsLies = projets.filter((projet) => projet.quoteId === source.quoteId);
    const montantPrepareHtCentimes = projetsLies.reduce(
      (somme, projet) => somme + projet.amountHtCents,
      0,
    );
    if (
      !Number.isSafeInteger(montantPrepareHtCentimes) ||
      montantPrepareHtCentimes > source.contractHtCents
    ) {
      throw new Error("BILLING_PREPARATION_EXCEEDS_CONTRACT");
    }
    const montantRestantHtCentimes = source.contractHtCents - montantPrepareHtCentimes;
    return {
      source,
      projectCount: projetsLies.length,
      preparedHtCents: montantPrepareHtCentimes,
      remainingToPrepareHtCents: montantRestantHtCentimes,
      status:
        montantPrepareHtCentimes === 0
          ? "NONE"
          : montantRestantHtCentimes === 0
            ? "FULL"
            : "PARTIAL",
    };
  });
}
