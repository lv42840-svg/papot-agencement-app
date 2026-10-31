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
  projects: readonly BillingDraft[],
): BillingPreparationRow[] {
  return sources.map((source) => {
    const related = projects.filter((project) => project.quoteId === source.quoteId);
    const preparedHtCents = related.reduce((sum, item) => sum + item.amountHtCents, 0);
    if (!Number.isSafeInteger(preparedHtCents) || preparedHtCents > source.contractHtCents) {
      throw new Error("BILLING_PREPARATION_EXCEEDS_CONTRACT");
    }
    const remainingToPrepareHtCents = source.contractHtCents - preparedHtCents;
    return {
      source,
      projectCount: related.length,
      preparedHtCents,
      remainingToPrepareHtCents,
      status: preparedHtCents === 0 ? "NONE" : remainingToPrepareHtCents === 0 ? "FULL" : "PARTIAL",
    };
  });
}
