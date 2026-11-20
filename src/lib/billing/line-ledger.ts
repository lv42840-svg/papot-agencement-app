import { lineHtCents } from "./document-lines";
import { belongsToBillingSource } from "./domain";
import type {
  BillingDocumentLine,
  BillingDraft,
  BillingLineProgress,
  BillingPayload,
  BillingSource,
  BillingSourceLine,
} from "./domain";

/** A FREE item is not a new contract: it consumes a named line's existing budget. */
export function allocatedBillingLineId(row: BillingDocumentLine): string | null {
  if (row.origin === "QUOTE") return row.sourceLineId;
  if (row.origin === "FREE") return row.allocationLineId ?? null;
  return null;
}

export function allocatedDocumentAmounts(
  rows: readonly BillingDocumentLine[],
  sourceLines: readonly BillingSourceLine[],
): Map<string, number> {
  const sourceById = new Map(sourceLines.map((line) => [line.lineId, line]));
  const amounts = new Map<string, number>();
  for (const row of rows) {
    if (row.origin === "TITLE") continue;
    const amount = lineHtCents(row);
    if (amount === 0) continue;
    const sourceId = allocatedBillingLineId(row);
    if (!sourceId) throw new Error("BILLING_PROGRESS_FREE_UNALLOCATED");
    const source = sourceById.get(sourceId);
    if (!source) throw new Error("BILLING_DOCUMENT_ALLOCATION_UNKNOWN");
    if (row.vatRatePercent !== source.vatRatePercent) {
      throw new Error("BILLING_DOCUMENT_ALLOCATION_VAT_MISMATCH");
    }
    const next = (amounts.get(sourceId) ?? 0) + amount;
    if (!Number.isSafeInteger(next)) throw new Error("BILLING_DOCUMENT_AMOUNT_INVALID");
    amounts.set(sourceId, next);
  }
  return amounts;
}

export function previousBillingLineAmounts(
  payload: BillingPayload,
  source: BillingSource,
  beforeDraftId?: string,
): Map<string, number> {
  const index = beforeDraftId
    ? payload.drafts.findIndex((candidate) => candidate.id === beforeDraftId)
    : -1;
  const history = payload.drafts
    .slice(0, index < 0 ? payload.drafts.length : index)
    .filter((item) => belongsToBillingSource(item, source));
  const totals = new Map<string, number>();
  for (const item of history) {
    if (!item.documentLines) {
      throw new Error("BILLING_PROGRESS_HISTORY_UNDETERMINED");
    }
    const allocated = allocatedDocumentAmounts(item.documentLines, source.lines ?? []);
    for (const [id, amount] of allocated) {
      const next = (totals.get(id) ?? 0) + amount;
      if (!Number.isSafeInteger(next)) throw new Error("BILLING_DOCUMENT_AMOUNT_INVALID");
      totals.set(id, next);
    }
  }
  return totals;
}

/**
 * Reconcile the real document (QUOTE + explicitly allocated FREE) against prior
 * preparations. Covers edits with unchanged grand totals and mixed VAT rates.
 * Prevents a free line from silently increasing a source line above 100 %.
 */
export function reconcileDocumentLineProgress(
  payload: BillingPayload,
  draft: BillingDraft,
  rows: readonly BillingDocumentLine[],
  expected?: readonly BillingLineProgress[],
): BillingLineProgress[] {
  const sources = draft.lines ?? [];
  if (!sources.length) throw new Error("BILLING_PROGRESS_LINES_UNAVAILABLE");
  const prior = previousBillingLineAmounts(payload, draft, draft.id);
  const current = allocatedDocumentAmounts(rows, sources);
  const priorPercentById = new Map<string, number>();
  const index = payload.drafts.findIndex((item) => item.id === draft.id);
  for (const historical of payload.drafts
    .slice(0, index < 0 ? payload.drafts.length : index)
    .filter((item) => belongsToBillingSource(item, draft) && item.type === "PROGRESS")) {
    for (const row of historical.lineProgress ?? []) {
      priorPercentById.set(row.lineId, Math.max(priorPercentById.get(row.lineId) ?? 0, row.cumulativeHtCents));
    }
  }
  return sources.map((source) => {
    const cumulativeHtCents = (prior.get(source.lineId) ?? 0) + (current.get(source.lineId) ?? 0);
    if (!Number.isSafeInteger(cumulativeHtCents) || cumulativeHtCents > source.amountHtCents) {
      throw new Error("BILLING_PROGRESS_LINE_EXCEEDS_CONTRACT");
    }
    if (cumulativeHtCents < (priorPercentById.get(source.lineId) ?? 0)) {
      throw new Error("BILLING_PROGRESS_CANNOT_DECREASE");
    }
    const selected = expected?.find((item) => item.lineId === source.lineId);
    if (expected && (!selected || selected.cumulativeHtCents !== cumulativeHtCents)) {
      throw new Error("BILLING_PROGRESS_DOCUMENT_MISMATCH");
    }
    return {
      lineId: source.lineId,
      percent: source.amountHtCents > 0
        ? (cumulativeHtCents * 100) / source.amountHtCents
        : 0,
      cumulativeHtCents,
    };
  });
}
