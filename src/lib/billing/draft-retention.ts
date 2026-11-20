import { z } from "zod";
import type { BillingDraft, BillingPayload } from "./domain";
import { assertBillingVisaEditable } from "./visa-policy";

/** Retention is a payment-term estimate on a project, not a posted invoice. */
export const billingDraftRetentionSchema = z
  .object({
    mode: z.enum(["PERCENT", "AMOUNT"]),
    ratePercent: z.number().finite().min(0).max(100),
    amountTtcCents: z.number().int().nonnegative().safe(),
  })
  .strict();
export type BillingDraftRetention = z.infer<typeof billingDraftRetentionSchema>;
export type BillingDraftRetentionMode = BillingDraftRetention["mode"];

function validateTotal(totalTtcCents: number): void {
  if (!Number.isSafeInteger(totalTtcCents) || totalTtcCents <= 0) {
    throw new Error("BILLING_RETENTION_TOTAL_INVALID");
  }
}

function toPercentage(amountTtcCents: number, totalTtcCents: number): number {
  return Math.round((amountTtcCents / totalTtcCents) * 10_000) / 100;
}

export function calculateBillingDraftRetention(
  mode: BillingDraftRetentionMode,
  value: number,
  totalTtcCents: number,
): BillingDraftRetention {
  validateTotal(totalTtcCents);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("BILLING_RETENTION_INPUT_INVALID");
  }
  if (mode === "PERCENT") {
    if (value > 100 || Math.abs(Math.round(value * 100) - value * 100) > 1e-8) {
      throw new Error("BILLING_RETENTION_PERCENT_INVALID");
    }
    const amountTtcCents = Math.round((totalTtcCents * value) / 100);
    if (!Number.isSafeInteger(amountTtcCents)) {
      throw new Error("BILLING_RETENTION_INPUT_INVALID");
    }
    return billingDraftRetentionSchema.parse({
      mode,
      ratePercent: value,
      amountTtcCents,
    });
  }
  if (mode !== "AMOUNT" || !Number.isSafeInteger(value) || value > totalTtcCents) {
    throw new Error("BILLING_RETENTION_EXCEEDS_TTC");
  }
  return billingDraftRetentionSchema.parse({
    mode,
    ratePercent: toPercentage(value, totalTtcCents),
    amountTtcCents: value,
  });
}

/** Called whenever the document's TTC changes before its internal approval. */
export function rebaseBillingDraftRetention(
  retention: BillingDraftRetention | undefined,
  totalTtcCents: number,
): BillingDraftRetention | undefined {
  if (!retention) return undefined;
  return calculateBillingDraftRetention(
    retention.mode,
    retention.mode === "PERCENT" ? retention.ratePercent : retention.amountTtcCents,
    totalTtcCents,
  );
}

export function setBillingDraftRetention(
  payload: BillingPayload,
  input: {
    draftId: string;
    expectedUpdatedAt: string;
    mode: BillingDraftRetentionMode;
    value: number;
  },
  actorName: string,
  now = new Date(),
): BillingPayload {
  const draft = payload.drafts.find((item) => item.id === input.draftId);
  if (!draft) throw new Error("BILLING_DRAFT_NOT_FOUND");
  if (draft.status !== "DRAFT") throw new Error("BILLING_DRAFT_LOCKED");
  if (draft.updatedAt !== input.expectedUpdatedAt) throw new Error("BILLING_VERSION_CONFLICT");
  assertBillingVisaEditable(payload, draft.id);
  if (payload.visaVersions?.some((version) => version.draftId === draft.id)) {
    // Payment conditions must not silently differ from an externally presented version.
    throw new Error("BILLING_RETENTION_AFTER_VISA");
  }
  const retention = calculateBillingDraftRetention(input.mode, input.value, draft.totalTtcCents);
  if (
    draft.retention?.mode === retention.mode &&
    draft.retention?.ratePercent === retention.ratePercent &&
    draft.retention?.amountTtcCents === retention.amountTtcCents
  ) {
    return payload;
  }
  return {
    ...payload,
    drafts: payload.drafts.map((item) =>
      item.id === draft.id
        ? {
            ...item,
            retention,
            updatedAt: now.toISOString(),
            updatedByName: actorName,
          }
        : item,
    ),
  };
}

/** Client-facing preview only. Does not create receivables. */
export function draftRetentionPreview(draft: BillingDraft) {
  const retention = rebaseBillingDraftRetention(draft.retention, draft.totalTtcCents);
  const heldTtcCents = retention?.amountTtcCents ?? 0;
  return {
    totalTtcCents: draft.totalTtcCents,
    retainedTtcCents: heldTtcCents,
    immediatelyClaimableTtcCents: draft.totalTtcCents - heldTtcCents,
    ratePercent: retention?.ratePercent ?? 0,
  };
}
