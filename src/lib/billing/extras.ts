import { billingExtraSchema } from "./domain";
import type { BillingExtra, BillingPayload } from "./domain";

export type NewBillingExtra = {
  requestId: string;
  chantierId: string;
  description: string;
  amountHtCents: number;
  vatRatePercent: number;
};

/** Adds an unconfirmed extra; never increases the billable market without evidence. */
export function addBillingExtra(
  payload: BillingPayload,
  input: NewBillingExtra,
  actorName: string,
  now = new Date(),
): BillingPayload {
  if (payload.extras?.some((extra) => extra.id === input.requestId)) return payload;
  const item: BillingExtra = billingExtraSchema.parse({
    id: input.requestId,
    lineId: globalThis.crypto.randomUUID(),
    chantierId: input.chantierId,
    description: input.description,
    amountHtCents: input.amountHtCents,
    vatRatePercent: input.vatRatePercent,
    agreementStatus: "TO_CONFIRM",
    agreementEvidence: null,
    confirmedAt: null,
    confirmedByName: null,
    createdAt: now.toISOString(),
    createdByName: actorName,
  });
  return { ...payload, extras: [...(payload.extras ?? []), item] };
}

/** Agreement confirmation is attributed, permanent, and idempotent for identical evidence. */
export function confirmBillingExtra(
  payload: BillingPayload,
  input: { extraId: string; evidence: string },
  actorName: string,
  now = new Date(),
): BillingPayload {
  const extras = payload.extras ?? [];
  const index = extras.findIndex((extra) => extra.id === input.extraId);
  if (index < 0) throw new Error("BILLING_EXTRA_NOT_FOUND");
  const previous = extras[index];
  if (previous.agreementStatus === "CONFIRMED") {
    if (previous.agreementEvidence === input.evidence.trim()) return payload;
    throw new Error("BILLING_EXTRA_ALREADY_CONFIRMED");
  }
  const confirmed: BillingExtra = billingExtraSchema.parse({
    ...previous,
    agreementStatus: "CONFIRMED",
    agreementEvidence: input.evidence.trim(),
    confirmedAt: now.toISOString(),
    confirmedByName: actorName,
  });
  return {
    ...payload,
    extras: extras.map((extra, i) => (i === index ? confirmed : extra)),
  };
}
