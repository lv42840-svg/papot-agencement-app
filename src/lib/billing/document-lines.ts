import type { BillingDocumentLine, BillingDraft, BillingPayload, BillingSourceLine } from "./domain";

export function lineHtCents(line: BillingDocumentLine): number {
  if (line.origin === "TITLE") return 0;
  const result = Math.round(line.quantity * line.unitPriceCents);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error("BILLING_DOCUMENT_AMOUNT_INVALID");
  }
  return result;
}

export function calculateInvoiceDocumentTotals(lines: BillingDocumentLine[]) {
  const byRate = new Map<number, number>();
  const amountHtCents = lines.reduce((sum, line) => {
    const value = lineHtCents(line);
    if (line.origin !== "TITLE") {
      byRate.set(line.vatRatePercent, (byRate.get(line.vatRatePercent) ?? 0) + value);
    }
    return sum + value;
  }, 0);
  if (!Number.isSafeInteger(amountHtCents) || amountHtCents <= 0) {
    throw new Error("BILLING_DOCUMENT_EMPTY");
  }
  const taxGroups = [...byRate.entries()]
    .map(([ratePercent, baseHtCents]) => ({
      ratePercent,
      baseHtCents,
      vatCents: Math.round((baseHtCents * ratePercent) / 100),
    }))
    .sort((a, b) => a.ratePercent - b.ratePercent);
  const vatCents = taxGroups.reduce((sum, group) => sum + group.vatCents, 0);
  return { amountHtCents, taxGroups, vatCents, totalTtcCents: amountHtCents + vatCents };
}

function distributeAmounts(
  lines: BillingSourceLine[],
  amountHtCents: number,
  weights: number[],
): number[] {
  if (!lines.length) return [];
  let weightsUsed = weights.map((value) => Math.max(0, value));
  if (weightsUsed.reduce((sum, value) => sum + value, 0) <= 0) {
    weightsUsed = lines.map((line) => line.amountHtCents);
  }
  const totalWeights = weightsUsed.reduce((sum, value) => sum + value, 0);
  if (totalWeights <= 0) return lines.map((_, i) => i === 0 ? amountHtCents : 0);
  const parts = lines.map((_, index) => {
    const raw = (amountHtCents * weightsUsed[index]) / totalWeights;
    return { index, amount: Math.floor(raw), fraction: raw % 1 };
  });
  let remaining = amountHtCents - parts.reduce((sum, part) => sum + part.amount, 0);
  for (const part of [...parts].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
    if (remaining <= 0) break;
    part.amount++;
    remaining--;
  }
  return parts.map((part) => part.amount);
}

/** Generates an independent editable snapshot; the retained quote is never changed. */
export function buildInvoiceDocumentLines(
  draft: BillingDraft,
  payload: BillingPayload,
): BillingDocumentLine[] {
  const draftIndex = payload.drafts.findIndex((item) => item.id === draft.id);
  const prior = payload.drafts.slice(0, draftIndex < 0 ? payload.drafts.length : draftIndex)
    .filter((item) => item.quoteId === draft.quoteId);
  const sourceLines = draft.lines ?? [];
  const output: BillingDocumentLine[] = [];

  for (const group of draft.taxGroups) {
    const matching = sourceLines.filter((line) => line.vatRatePercent === group.ratePercent);
    if (!matching.length) {
      output.push({
        id: globalThis.crypto.randomUUID(),
        origin: "FREE", sourceLineId: null,
        description: `Prestation selon devis ${draft.quoteLabel}`,
        quantity: 1, unit: "forfait", unitPriceCents: group.baseHtCents,
        vatRatePercent: group.ratePercent,
      });
      continue;
    }

    const previousSituations = prior.filter((item) => item.type === "PROGRESS");
    const weights = matching.map((line) => {
      const target = draft.lineProgress?.find((row) => row.lineId === line.lineId)?.cumulativeHtCents;
      if (target === undefined) return line.amountHtCents;
      const previousTarget = previousSituations.reduce((maximum, item) => {
        const row = item.lineProgress?.find((entry) => entry.lineId === line.lineId);
        const amount = row?.cumulativeHtCents ??
          (item.cumulativePercent === null ? 0 :
            Math.round(line.amountHtCents * item.cumulativePercent / 100));
        return Math.max(maximum, amount);
      }, 0);
      return Math.max(0, target - previousTarget);
    });
    const allocated = distributeAmounts(matching, group.baseHtCents, weights);
    matching.forEach((source, index) => {
      const amount = allocated[index];
      const quantity = source.quantity ?? 1;
      const roundedUnit = Math.round(amount / quantity);
      const exact = amount > 0 && Number.isSafeInteger(roundedUnit) &&
        Math.round(quantity * roundedUnit) === amount;
      output.push({
        id: globalThis.crypto.randomUUID(),
        origin: "QUOTE", sourceLineId: source.lineId,
        description: source.description,
        quantity: exact ? quantity : 1,
        unit: exact ? (source.unit ?? "u") : "forfait",
        unitPriceCents: exact ? roundedUnit : amount,
        vatRatePercent: source.vatRatePercent,
      });
    });
  }
  return output;
}
