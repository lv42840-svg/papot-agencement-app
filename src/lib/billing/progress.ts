import type { BillingDraft, BillingLineProgress, BillingPayload, BillingSource } from "./domain";

export type LineProgressInput = { lineId: string; percent: number };

export type LineProgressResult = {
  amountHtCents: number;
  tax: {
    groups: BillingDraft["taxGroups"];
    vatCents: number;
    ttcCents: number;
  };
  lineProgress: BillingLineProgress[];
};

export function calculateLineProgress(
  payload: BillingPayload,
  source: BillingSource,
  percentages: LineProgressInput[],
): LineProgressResult {
  const lines = source.lines;
  if (!lines?.length) throw new Error("BILLING_PROGRESS_LINES_UNAVAILABLE");
  if (percentages.length !== lines.length) throw new Error("BILLING_PROGRESS_LINES_REQUIRED");

  const inputById = new Map<string, number>();
  for (const row of percentages) {
    if (
      inputById.has(row.lineId) ||
      !Number.isFinite(row.percent) ||
      row.percent < 0 ||
      row.percent > 100
    ) {
      throw new Error("BILLING_PROGRESS_PERCENT_INVALID");
    }
    inputById.set(row.lineId, row.percent);
  }
  if (inputById.size !== lines.length || lines.some((line) => !inputById.has(line.lineId))) {
    throw new Error("BILLING_PROGRESS_LINES_REQUIRED");
  }

  const previousDrafts = payload.drafts.filter((draft) => draft.quoteId === source.quoteId);
  const history = previousDrafts.filter((draft) => draft.type === "PROGRESS");
  if (history.some((draft) => !draft.lineProgress?.length && draft.cumulativePercent === null)) {
    throw new Error("BILLING_PROGRESS_HISTORY_UNDETERMINED");
  }

  const lineProgress: BillingLineProgress[] = lines.map((line) => {
    const percent = inputById.get(line.lineId)!;
    const prior = history.reduce((max, draft) => {
      const historic = draft.lineProgress?.find((row) => row.lineId === line.lineId);
      const historicPercent = historic?.percent ?? draft.cumulativePercent ?? 0;
      return Math.max(max, historicPercent);
    }, 0);
    if (percent < prior) throw new Error("BILLING_PROGRESS_CANNOT_DECREASE");
    return {
      lineId: line.lineId,
      percent,
      cumulativeHtCents: Math.round((line.amountHtCents * percent) / 100),
    };
  });

  const targetByRate = new Map<number, number>(
    source.contractTaxGroups.map((group) => [group.ratePercent, 0]),
  );
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const target = lineProgress[index].cumulativeHtCents;
    targetByRate.set(line.vatRatePercent, (targetByRate.get(line.vatRatePercent) ?? 0) + target);
  }

  const previousByRate = new Map<number, number>();
  for (const draft of previousDrafts) {
    for (const group of draft.taxGroups) {
      previousByRate.set(
        group.ratePercent,
        (previousByRate.get(group.ratePercent) ?? 0) + group.baseHtCents,
      );
    }
  }

  const groups: BillingDraft["taxGroups"] = source.contractTaxGroups.map((contract) => {
    const cumulative = targetByRate.get(contract.ratePercent) ?? 0;
    const prepared = previousByRate.get(contract.ratePercent) ?? 0;
    const baseHtCents = cumulative - prepared;
    if (baseHtCents < 0) throw new Error("BILLING_PROGRESS_TAX_ALLOCATION_UNAVAILABLE");
    return {
      ratePercent: contract.ratePercent,
      baseHtCents,
      vatCents: Math.round((baseHtCents * contract.ratePercent) / 100),
    };
  });
  const amountHtCents = groups.reduce((sum, group) => sum + group.baseHtCents, 0);
  const previousTotal = previousDrafts.reduce((sum, draft) => sum + draft.amountHtCents, 0);
  const contractRemaining = source.contractHtCents - previousTotal;
  if (contractRemaining <= 0) throw new Error("BILLING_CONTRACT_ALREADY_PREPARED");
  if (amountHtCents <= 0) throw new Error("BILLING_AMOUNT_INVALID");
  if (amountHtCents > contractRemaining) throw new Error("BILLING_AMOUNT_EXCEEDS_CONTRACT");
  const vatCents = groups.reduce((sum, group) => sum + group.vatCents, 0);
  return {
    amountHtCents,
    tax: { groups, vatCents, ttcCents: amountHtCents + vatCents },
    lineProgress,
  };
}
