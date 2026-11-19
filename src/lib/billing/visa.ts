import { calculateInvoiceDocumentTotals } from "./document-lines";
import {
  billingVisaRequirementSchema,
  billingVisaVersionSchema,
} from "./domain";
import type {
  BillingDraft,
  BillingPayload,
  BillingVisaMethod,
  BillingVisaVersion,
} from "./domain";

export function latestBillingVisa(
  payload: BillingPayload,
  draftId: string,
): BillingVisaVersion | null {
  const versions = (payload.visaVersions ?? []).filter((item) => item.draftId === draftId);
  return versions.at(-1) ?? null;
}

export function visaRequiredForChantier(
  payload: BillingPayload,
  chantierId: string | null,
): boolean {
  return Boolean(
    chantierId &&
      payload.visaRequirements?.find((item) => item.chantierId === chantierId)?.required,
  );
}

/** A pending presentation freezes the document until a decision or a withdrawal. */
export function assertBillingVisaEditable(payload: BillingPayload, draftId: string): void {
  if (latestBillingVisa(payload, draftId)?.status === "SUBMITTED") {
    throw new Error("BILLING_VISA_PENDING");
  }
}

/** No internal approval may bypass a requested or mandatory external visa. */
export function assertBillingVisaAllowsApproval(
  payload: BillingPayload,
  draft: BillingDraft,
): void {
  const latest = latestBillingVisa(payload, draft.id);
  if (latest?.status === "SUBMITTED") throw new Error("BILLING_VISA_PENDING");
  if (latest?.status === "PARTIAL") throw new Error("BILLING_VISA_PARTIAL_REWORK_REQUIRED");
  if (latest?.status === "REFUSED") throw new Error("BILLING_VISA_REFUSED");
  if (latest?.status === "ACCEPTED" && latest.draftUpdatedAt !== draft.updatedAt) {
    throw new Error("BILLING_VISA_STALE");
  }
  if (visaRequiredForChantier(payload, draft.chantierId) && latest?.status !== "ACCEPTED") {
    throw new Error("BILLING_VISA_REQUIRED");
  }
}

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
    visaRequirements: [
      ...rules.filter((rule) => rule.chantierId !== chantierId),
      next,
    ],
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
  ) throw new Error("BILLING_APPROVAL_TOTALS_MISMATCH");

  const version = billingVisaVersionSchema.parse({
    id: globalThis.crypto.randomUUID(),
    draftId: draft.id,
    version: past.length + 1,
    draftUpdatedAt: draft.updatedAt,
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
  const accepted =
    input.decision === "ACCEPTED"
      ? latest.amountHtCents
      : input.decision === "REFUSED"
        ? 0
        : input.acceptedHtCents;
  const reviewed = billingVisaVersionSchema.parse({
    ...latest,
    status: input.decision,
    acceptedHtCents: accepted,
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
