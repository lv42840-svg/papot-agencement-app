import type { BillingDraft, BillingPayload, BillingVisaVersion } from "./domain";

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

