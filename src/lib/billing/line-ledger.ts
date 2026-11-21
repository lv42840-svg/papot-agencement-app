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
    // A deposit on the entire chantier is a VAT-rate credit, not a physical
    // progress allocation. A historic deposit on one signed quote, however,
    // must stay attributed to that quote when several quotes are consolidated.
    .filter(
      (item) =>
        belongsToBillingSource(item, source) &&
        (item.type !== "DEPOSIT" ||
          (source.sourceMode === "CHANTIER" &&
            item.sourceMode !== "CHANTIER" &&
            item.quoteId !== source.quoteId)),
    );
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
 * Keep physical progress distinct from billable amounts. Deposits are credited
 * by VAT rate and must not artificially advance (or regress) an ouvrage.
 *
 * An explicitly allocated FREE item consumes the billable part of its source,
 * but cannot push it beyond the cumulative physical work accepted.
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
  const sourceIds = new Set(sources.map((source) => source.lineId));
  const chosen = expected ?? draft.lineProgress;
  if (
    !chosen ||
    chosen.length !== sourceIds.size ||
    chosen.some((row) => !sourceIds.has(row.lineId))
  ) {
    throw new Error("BILLING_PROGRESS_HISTORY_UNDETERMINED");
  }
  const targets = new Map(chosen.map((row) => [row.lineId, row]));
  if (targets.size !== sources.length) throw new Error("BILLING_PROGRESS_LINES_REQUIRED");

  const previousPhysical = new Map<string, number>();
  const index = payload.drafts.findIndex((item) => item.id === draft.id);
  for (const historical of payload.drafts
    .slice(0, index < 0 ? payload.drafts.length : index)
    .filter((item) => belongsToBillingSource(item, draft) && item.type === "PROGRESS")) {
    for (const row of historical.lineProgress ?? []) {
      previousPhysical.set(
        row.lineId,
        Math.max(previousPhysical.get(row.lineId) ?? 0, row.cumulativeHtCents),
      );
    }
  }

  return sources.map((source) => {
    const selected = targets.get(source.lineId);
    if (!selected) throw new Error("BILLING_PROGRESS_LINES_REQUIRED");
    const target = selected.cumulativeHtCents;
    if (target > source.amountHtCents || target < 0) {
      throw new Error("BILLING_PROGRESS_LINE_EXCEEDS_CONTRACT");
    }
    if (target < (previousPhysical.get(source.lineId) ?? 0)) {
      throw new Error("BILLING_PROGRESS_CANNOT_DECREASE");
    }
    const billed = (prior.get(source.lineId) ?? 0) + (current.get(source.lineId) ?? 0);
    if (!Number.isSafeInteger(billed) || billed > source.amountHtCents) {
      throw new Error("BILLING_PROGRESS_LINE_EXCEEDS_CONTRACT");
    }
    if (billed > target) {
      throw new Error("BILLING_PROGRESS_LINE_EXCEEDS_CUMULATIVE");
    }
    return selected;
  });
}
