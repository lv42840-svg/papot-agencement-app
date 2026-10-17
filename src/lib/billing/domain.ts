import { z } from "zod";

const centsSchema = z.number().int().nonnegative().safe();
const dateTimeSchema = z.string().datetime({ offset: true });

export const billingTypeSchema = z.enum(["STANDARD", "DEPOSIT", "PROGRESS", "FINAL"]);
export type BillingType = z.infer<typeof billingTypeSchema>;

export const billingTaxGroupSchema = z.object({
  ratePercent: z.number().finite().min(0).max(100),
  baseHtCents: centsSchema,
});
export type BillingTaxGroup = z.infer<typeof billingTaxGroupSchema>;

export const billingSourceSchema = z.object({
  quoteId: z.string().uuid(),
  commercialCaseId: z.string().uuid(),
  chantierId: z.string().uuid().nullable(),
  clientId: z.string().uuid(),
  clientName: z.string().min(1),
  affairName: z.string().min(1),
  quoteLabel: z.string().min(1),
  contractHtCents: centsSchema.positive(),
  contractTaxGroups: z.array(billingTaxGroupSchema).min(1),
});
export type BillingSource = z.infer<typeof billingSourceSchema>;

export const billingDraftSchema = billingSourceSchema.extend({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  status: z.literal("DRAFT"),
  type: billingTypeSchema,
  label: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(4000),
  amountHtCents: centsSchema.positive(),
  taxGroups: z.array(
    billingTaxGroupSchema.extend({ vatCents: centsSchema }),
  ).min(1),
  vatCents: centsSchema,
  totalTtcCents: centsSchema.positive(),
  cumulativePercent: z.number().finite().min(0).max(100).nullable(),
  createdAt: dateTimeSchema,
  createdByName: z.string().trim().min(1),
  updatedAt: dateTimeSchema,
  updatedByName: z.string().trim().min(1),
});
export type BillingDraft = z.infer<typeof billingDraftSchema>;

export const billingPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  drafts: z.array(billingDraftSchema),
});
export type BillingPayload = z.infer<typeof billingPayloadSchema>;

export function parseBillingPayload(value: unknown): BillingPayload {
  if (value === null || value === undefined) return { schemaVersion: 1, drafts: [] };
  return billingPayloadSchema.parse(value);
}

export function preparedHtCents(
  payload: BillingPayload,
  quoteId: string,
  excludingId?: string,
): number {
  return payload.drafts
    .filter((draft) => draft.quoteId === quoteId && draft.id !== excludingId)
    .reduce((sum, draft) => sum + draft.amountHtCents, 0);
}

function assertSource(source: BillingSource): BillingSource {
  const valid = billingSourceSchema.parse(source);
  if (
    valid.contractTaxGroups.reduce((sum, group) => sum + group.baseHtCents, 0) !==
    valid.contractHtCents
  ) {
    throw new Error("BILLING_SOURCE_TOTAL_MISMATCH");
  }
  return valid;
}

export function distributeBillingTax(
  groups: BillingTaxGroup[],
  amountHtCents: number,
): { groups: BillingDraft["taxGroups"]; vatCents: number; ttcCents: number } {
  if (!Number.isSafeInteger(amountHtCents) || amountHtCents <= 0) {
    throw new Error("BILLING_AMOUNT_INVALID");
  }
  const contractHtCents = groups.reduce((sum, group) => sum + group.baseHtCents, 0);
  if (!Number.isSafeInteger(contractHtCents) || amountHtCents > contractHtCents) {
    throw new Error("BILLING_AMOUNT_EXCEEDS_CONTRACT");
  }
  // Largest remainder keeps the total at exactly the requested cent, across VAT rates.
  const allocations = groups.map((group, index) => {
    const raw = (amountHtCents * group.baseHtCents) / contractHtCents;
    return { index, ratePercent: group.ratePercent, baseHtCents: Math.floor(raw), fraction: raw % 1 };
  });
  let remaining = amountHtCents - allocations.reduce((sum, row) => sum + row.baseHtCents, 0);
  for (const row of [...allocations].sort((a, b) => b.fraction - a.fraction || a.index - b.index)) {
    if (remaining <= 0) break;
    row.baseHtCents += 1;
    remaining -= 1;
  }
  const taxGroups = allocations.map((row) => ({
    ratePercent: row.ratePercent,
    baseHtCents: row.baseHtCents,
    vatCents: Math.round((row.baseHtCents * row.ratePercent) / 100),
  }));
  const vatCents = taxGroups.reduce((sum, group) => sum + group.vatCents, 0);
  return { groups: taxGroups, vatCents, ttcCents: amountHtCents + vatCents };
}

export function resolveBillingAmount(input: {
  type: BillingType;
  contractHtCents: number;
  alreadyPreparedCents: number;
  amountHtCents?: number;
  cumulativePercent?: number;
}): number {
  const { type, contractHtCents, alreadyPreparedCents } = input;
  const remaining = contractHtCents - alreadyPreparedCents;
  if (remaining <= 0) throw new Error("BILLING_CONTRACT_ALREADY_PREPARED");
  let amountHtCents: number;
  if (type === "STANDARD" || type === "FINAL") {
    amountHtCents = remaining;
  } else if (input.cumulativePercent !== undefined) {
    if (
      !Number.isFinite(input.cumulativePercent) ||
      input.cumulativePercent <= 0 ||
      input.cumulativePercent > 100
    ) throw new Error("BILLING_PERCENT_INVALID");
    const percentTarget = Math.round((contractHtCents * input.cumulativePercent) / 100);
    // Situation = cumulative advancement, from which previous invoices/deposits are deducted.
    // Deposit = percentage of the contract, not cumulative advancement.
    amountHtCents =
      type === "PROGRESS" ? percentTarget - alreadyPreparedCents : percentTarget;
  } else {
    amountHtCents = input.amountHtCents ?? 0;
  }
  if (!Number.isSafeInteger(amountHtCents) || amountHtCents <= 0) {
    throw new Error("BILLING_AMOUNT_INVALID");
  }
  if (amountHtCents > remaining) throw new Error("BILLING_AMOUNT_EXCEEDS_CONTRACT");
  return amountHtCents;
}

export function createBillingDraft(
  payload: BillingPayload,
  source: BillingSource,
  input: {
    requestId: string;
    type: BillingType;
    amountHtCents?: number;
    cumulativePercent?: number;
  },
  actorName: string,
  now = new Date(),
): BillingDraft {
  const validSource = assertSource(source);
  const alreadyPreparedCents = preparedHtCents(payload, source.quoteId);
  const amountHtCents = resolveBillingAmount({
    ...input,
    contractHtCents: validSource.contractHtCents,
    alreadyPreparedCents,
  });
  const tax = distributeBillingTax(validSource.contractTaxGroups, amountHtCents);
  const typeLabel: Record<BillingType, string> = {
    STANDARD: "Facture classique",
    DEPOSIT: "Facture d'acompte",
    PROGRESS: "Facture de situation",
    FINAL: "Facture de solde",
  };
  return billingDraftSchema.parse({
    ...validSource,
    id: globalThis.crypto.randomUUID(),
    requestId: input.requestId,
    status: "DRAFT",
    type: input.type,
    label: typeLabel[input.type],
    notes: "",
    amountHtCents,
    taxGroups: tax.groups,
    vatCents: tax.vatCents,
    totalTtcCents: tax.ttcCents,
    cumulativePercent: input.cumulativePercent ?? null,
    createdAt: now.toISOString(),
    createdByName: actorName,
    updatedAt: now.toISOString(),
    updatedByName: actorName,
  });
}

export function updateBillingDraft(
  payload: BillingPayload,
  draftId: string,
  input: {
    expectedUpdatedAt: string;
    label: string;
    notes: string;
    amountHtCents?: number;
  },
  actorName: string,
  now = new Date(),
): BillingDraft {
  const draft = payload.drafts.find((item) => item.id === draftId);
  if (!draft) throw new Error("BILLING_DRAFT_NOT_FOUND");
  if (draft.updatedAt !== input.expectedUpdatedAt) throw new Error("BILLING_VERSION_CONFLICT");
  const alreadyPreparedCents = preparedHtCents(payload, draft.quoteId, draft.id);
  const amountHtCents =
    draft.type === "STANDARD" || draft.type === "FINAL"
      ? draft.amountHtCents
      : input.amountHtCents ?? draft.amountHtCents;
  if (amountHtCents + alreadyPreparedCents > draft.contractHtCents) {
    throw new Error("BILLING_AMOUNT_EXCEEDS_CONTRACT");
  }
  const tax = distributeBillingTax(draft.contractTaxGroups, amountHtCents);
  return billingDraftSchema.parse({
    ...draft,
    label: input.label,
    notes: input.notes,
    amountHtCents,
    taxGroups: tax.groups,
    vatCents: tax.vatCents,
    totalTtcCents: tax.ttcCents,
    // Editing the amount explicitly switches the draft away from a cumulative percentage.
    cumulativePercent:
      amountHtCents !== draft.amountHtCents ? null : draft.cumulativePercent,
    updatedAt: now.toISOString(),
    updatedByName: actorName,
  });
}
