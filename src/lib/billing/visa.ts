import { calculateInvoiceDocumentTotals, lineHtCents } from "./document-lines";
import { billingDraftSchema, updateBillingDocument } from "./domain";
import { allocatedDocumentAmounts, reconcileDocumentLineProgress } from "./line-ledger";
import type { BillingDocumentLine, BillingVisaLineDecision } from "./domain";
import { billingVisaRequirementSchema, billingVisaVersionSchema } from "./domain";
import type { BillingPayload, BillingVisaMethod } from "./domain";
import { assertBillingVisaEditable, latestBillingVisa } from "./visa-policy";
export {
  assertBillingVisaEditable,
  assertBillingVisaAllowsApproval,
  latestBillingVisa,
  visaRequiredForChantier,
} from "./visa-policy";

export function setBillingVisaRequirement(
  payload: BillingPayload,
  chantierId: string,
  required: boolean,
  actorName: string,
  now = new Date(),
): BillingPayload {
  const rules = payload.visaRequirements ?? [];
  if (rules.some((item) => item.chantierId === chantierId && item.required === required)) {
    return payload;
  }
  const next = billingVisaRequirementSchema.parse({
    chantierId,
    required,
    updatedAt: now.toISOString(),
    updatedByName: actorName,
  });
  return {
    ...payload,
    visaRequirements: [...rules.filter((rule) => rule.chantierId !== chantierId), next],
  };
}

/**
 * Store the exact saved document as a numbered provisional version.
 * This records a presentation to a third party, not an email or a legal invoice.
 */
export function presentBillingVisa(
  payload: BillingPayload,
  input: {
    draftId: string;
    expectedUpdatedAt: string;
    submittedTo: string;
    submittedNotes: string;
  },
  actorName: string,
  now = new Date(),
): BillingPayload {
  const draft = payload.drafts.find((item) => item.id === input.draftId);
  if (!draft) throw new Error("BILLING_DRAFT_NOT_FOUND");
  if (draft.status !== "DRAFT") throw new Error("BILLING_DRAFT_LOCKED");
  if (draft.updatedAt !== input.expectedUpdatedAt) throw new Error("BILLING_VERSION_CONFLICT");
  assertBillingVisaEditable(payload, draft.id);
  const past = (payload.visaVersions ?? []).filter((v) => v.draftId === draft.id);
  if (past.length >= 100) throw new Error("BILLING_VISA_VERSION_LIMIT");
  const lines = draft.documentLines;
  if (!lines?.length) throw new Error("BILLING_DOCUMENT_EDIT_REQUIRED");
  const totals = calculateInvoiceDocumentTotals(lines);
  if (
    totals.amountHtCents !== draft.amountHtCents ||
    totals.vatCents !== draft.vatCents ||
    totals.totalTtcCents !== draft.totalTtcCents
  )
    throw new Error("BILLING_APPROVAL_TOTALS_MISMATCH");

  const version = billingVisaVersionSchema.parse({
    id: globalThis.crypto.randomUUID(),
    draftId: draft.id,
    version: past.length + 1,
    draftUpdatedAt: draft.updatedAt,
    clientName: draft.clientName,
    chantierName: draft.affairName,
    documentLabel: draft.label,
    documentNotes: draft.notes,
    documentLines: lines.map((line) => ({ ...line })),
    amountHtCents: draft.amountHtCents,
    vatCents: draft.vatCents,
    totalTtcCents: draft.totalTtcCents,
    submittedTo: input.submittedTo,
    submittedNotes: input.submittedNotes,
    submittedAt: now.toISOString(),
    submittedByName: actorName,
    status: "SUBMITTED",
    acceptedHtCents: null,
    reviewMethod: null,
    externalContact: null,
    evidence: null,
    reason: null,
    reviewedAt: null,
    reviewedByName: null,
  });
  return { ...payload, visaVersions: [...(payload.visaVersions ?? []), version] };
}

export function recordBillingVisaDecision(
  payload: BillingPayload,
  input: {
    draftId: string;
    version: number;
    decision: "ACCEPTED" | "PARTIAL" | "REFUSED";
    acceptedHtCents?: number;
    lineDecisions?: BillingVisaLineDecision[];
    reviewMethod: BillingVisaMethod;
    externalContact: string;
    evidence: string;
    reason: string;
  },
  actorName: string,
  now = new Date(),
): BillingPayload {
  const latest = latestBillingVisa(payload, input.draftId);
  if (!latest) throw new Error("BILLING_VISA_NOT_FOUND");
  if (latest.version !== input.version) throw new Error("BILLING_VISA_VERSION_CONFLICT");
  if (latest.status !== "SUBMITTED") throw new Error("BILLING_VISA_ALREADY_REVIEWED");
  let accepted: number | undefined;
  if (input.decision === "PARTIAL") {
    const billable = latest.documentLines.filter((line) => line.origin !== "TITLE");
    const decisions = input.lineDecisions;
    if (!decisions?.length || decisions.length !== billable.length) {
      throw new Error("BILLING_VISA_LINE_DECISIONS_REQUIRED");
    }
    const byId = new Map(billable.map((line) => [line.id, line]));
    const used = new Set<string>();
    let subtotal = 0;
    for (const row of decisions) {
      const original = byId.get(row.documentLineId);
      if (!original || used.has(row.documentLineId)) {
        throw new Error("BILLING_VISA_LINE_DECISION_INVALID");
      }
      used.add(row.documentLineId);
      if (
        !Number.isSafeInteger(row.acceptedHtCents) ||
        row.acceptedHtCents < 0 ||
        row.acceptedHtCents > lineHtCents(original)
      )
        throw new Error("BILLING_VISA_LINE_AMOUNT_INVALID");
      if (row.acceptedHtCents < lineHtCents(original) && !row.reason.trim()) {
        throw new Error("BILLING_VISA_LINE_REASON_REQUIRED");
      }
      subtotal += row.acceptedHtCents;
    }
    if (!Number.isSafeInteger(subtotal) || subtotal <= 0 || subtotal >= latest.amountHtCents) {
      throw new Error("BILLING_VISA_PARTIAL_TOTAL_INVALID");
    }
    if (input.acceptedHtCents !== undefined && input.acceptedHtCents !== subtotal) {
      throw new Error("BILLING_VISA_LINE_TOTAL_MISMATCH");
    }
    accepted = subtotal;
  } else {
    if (input.lineDecisions?.length) throw new Error("BILLING_VISA_LINE_DECISIONS_NOT_PARTIAL");
    accepted = input.decision === "ACCEPTED" ? latest.amountHtCents : 0;
  }
  const reviewed = billingVisaVersionSchema.parse({
    ...latest,
    status: input.decision,
    acceptedHtCents: accepted,
    ...(input.decision === "PARTIAL" ? { lineDecisions: input.lineDecisions } : {}),
    reviewMethod: input.reviewMethod,
    externalContact: input.externalContact,
    evidence: input.evidence,
    reason: input.reason,
    reviewedAt: now.toISOString(),
    reviewedByName: actorName,
  });
  return {
    ...payload,
    visaVersions: (payload.visaVersions ?? []).map((visa) =>
      visa.id === reviewed.id ? reviewed : visa,
    ),
  };
}

/**
 * Apply a line-by-line partial external visa to the SAME draft.
 * The archived V1 document remains immutable. The revised document must be
 * presented again (V2) before the draft can receive internal approval.
 */
export function applyBillingVisaPartial(
  payload: BillingPayload,
  input: { draftId: string; version: number; expectedUpdatedAt: string },
  actorName: string,
  now = new Date(),
): BillingPayload {
  const index = payload.drafts.findIndex((draft) => draft.id === input.draftId);
  if (index < 0) throw new Error("BILLING_DRAFT_NOT_FOUND");
  const draft = payload.drafts[index];
  if (draft.status !== "DRAFT") throw new Error("BILLING_DRAFT_LOCKED");
  if (draft.updatedAt !== input.expectedUpdatedAt) throw new Error("BILLING_VERSION_CONFLICT");

  const latest = latestBillingVisa(payload, draft.id);
  if (!latest || latest.version !== input.version) {
    throw new Error("BILLING_VISA_VERSION_CONFLICT");
  }
  if (latest.status !== "PARTIAL" || !latest.lineDecisions?.length) {
    throw new Error("BILLING_VISA_LINES_NOT_APPLICABLE");
  }
  if (latest.appliedAt) throw new Error("BILLING_VISA_ALREADY_APPLIED");
  if (
    latest.draftUpdatedAt !== draft.updatedAt ||
    latest.documentLabel !== draft.label ||
    latest.documentNotes !== draft.notes ||
    JSON.stringify(latest.documentLines) !== JSON.stringify(draft.documentLines)
  )
    throw new Error("BILLING_VISA_STALE");

  const acceptedById = new Map(
    latest.lineDecisions.map((decision) => [decision.documentLineId, decision.acceptedHtCents]),
  );
  const acceptedLines: BillingDocumentLine[] = [];
  for (const line of latest.documentLines) {
    if (line.origin === "TITLE") {
      acceptedLines.push({ ...line });
      continue;
    }
    const accepted = acceptedById.get(line.id);
    if (accepted === undefined) throw new Error("BILLING_VISA_LINE_DECISIONS_REQUIRED");
    if (accepted === 0) continue;
    const originalHt = lineHtCents(line);
    if (accepted === originalHt) {
      acceptedLines.push({ ...line });
      continue;
    }

    // Preserve quantities where an exact amount can be expressed with the
    // original unit price. Otherwise use a clearly labelled accepted forfait.
    const ratio = line.unitPriceCents > 0 ? accepted / line.unitPriceCents : 0;
    const roundedQty = Math.round(ratio * 1000) / 1000;
    if (
      roundedQty > 0 &&
      roundedQty <= line.quantity &&
      Math.round(roundedQty * line.unitPriceCents) === accepted
    ) {
      acceptedLines.push({ ...line, quantity: roundedQty });
    } else {
      acceptedLines.push({
        ...line,
        description: `${line.description.slice(0, 3970)} (partie acceptée V${latest.version})`,
        quantity: 1,
        unit: "forfait",
        unitPriceCents: accepted,
      });
    }
  }
  if (!acceptedLines.some((line) => line.origin !== "TITLE")) {
    throw new Error("BILLING_VISA_DOCUMENT_EMPTY");
  }

  // A progress statement must preserve a coherent cumulative ledger for the
  // next situation. Unallocated free rows cannot be reconciled automatically.
  if (
    draft.type === "PROGRESS" &&
    latest.documentLines.some(
      (line) =>
        line.origin === "FREE" &&
        lineHtCents(line) > 0 &&
        !line.allocationLineId,
    )
  ) {
    throw new Error("BILLING_VISA_PROGRESS_FREE_LINES_UNSUPPORTED");
  }

  const changed = updateBillingDocument(
    payload,
    draft.id,
    {
      expectedUpdatedAt: draft.updatedAt,
      label: draft.label,
      notes: draft.notes,
      documentLines: acceptedLines,
    },
    actorName,
    now,
  );
  let updated = changed;
  if (draft.type === "PROGRESS") {
    const sources = draft.lines ?? [];
    if (!draft.lineProgress?.length || !sources.length) {
      throw new Error("BILLING_PROGRESS_HISTORY_UNDETERMINED");
    }
    const before = allocatedDocumentAmounts(latest.documentLines, sources);
    const after = allocatedDocumentAmounts(acceptedLines, sources);
    const sourceById = new Map(sources.map((line) => [line.lineId, line]));
    const adjusted = draft.lineProgress.map((row) => {
      const source = sourceById.get(row.lineId);
      if (!source) throw new Error("BILLING_PROGRESS_LINES_REQUIRED");
      const rejected = (before.get(row.lineId) ?? 0) - (after.get(row.lineId) ?? 0);
      if (rejected < 0) throw new Error("BILLING_VISA_LINE_AMOUNT_INVALID");
      const cumulativeHtCents = row.cumulativeHtCents - rejected;
      if (cumulativeHtCents < 0) throw new Error("BILLING_PROGRESS_CANNOT_DECREASE");
      return {
        lineId: row.lineId,
        cumulativeHtCents,
        percent: source.amountHtCents > 0 ? (cumulativeHtCents * 100) / source.amountHtCents : 0,
      };
    });
    reconcileDocumentLineProgress(payload, draft, acceptedLines, adjusted);
    updated = billingDraftSchema.parse({
      ...changed,
      lineProgress: adjusted,
      cumulativePercent: null,
    });
  }

  const applied = billingVisaVersionSchema.parse({
    ...latest,
    appliedAt: now.toISOString(),
    appliedByName: actorName,
  });
  return {
    ...payload,
    drafts: payload.drafts.map((item) => (item.id === updated.id ? updated : item)),
    visaVersions: (payload.visaVersions ?? []).map((item) =>
      item.id === applied.id ? applied : item,
    ),
  };
}

export function withdrawBillingVisa(
  payload: BillingPayload,
  input: { draftId: string; version: number; reason: string },
  actorName: string,
  now = new Date(),
): BillingPayload {
  const latest = latestBillingVisa(payload, input.draftId);
  if (!latest) throw new Error("BILLING_VISA_NOT_FOUND");
  if (latest.version !== input.version) throw new Error("BILLING_VISA_VERSION_CONFLICT");
  if (latest.status !== "SUBMITTED") throw new Error("BILLING_VISA_ALREADY_REVIEWED");
  const withdrawn = billingVisaVersionSchema.parse({
    ...latest,
    status: "WITHDRAWN",
    reason: input.reason,
    reviewedAt: now.toISOString(),
    reviewedByName: actorName,
  });
  return {
    ...payload,
    visaVersions: (payload.visaVersions ?? []).map((visa) =>
      visa.id === withdrawn.id ? withdrawn : visa,
    ),
  };
}
