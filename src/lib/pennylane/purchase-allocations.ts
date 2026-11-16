import { z } from "zod";

/** A supplier bill can be split across sites, after-sales work and overheads. */
export const invoiceDestinationSchema = z
  .object({
    kind: z.enum(["CHANTIER", "SAV", "GENERAL_EXPENSES"]),
    chantierId: z.string().uuid().nullable(),
  })
  .superRefine((item, ctx) => {
    if ((item.kind === "CHANTIER") !== (item.chantierId !== null)) {
      ctx.addIssue({ code: "custom", message: "INVOICE_DESTINATION_INVALID" });
    }
  });
export type InvoiceDestination = z.infer<typeof invoiceDestinationSchema>;

const signedCents = z.number().int().safe().min(-100_000_000_000).max(100_000_000_000);
const nonNegativeCents = signedCents.nonnegative();

export const invoiceAllocationDraftSchema = z
  .object({
    mode: z.enum(["GLOBAL", "LINES"]),
    rows: z
      .array(
        z.object({
          id: z.string().uuid(),
          sourceLineId: z.string().nullable(),
          destination: invoiceDestinationSchema,
          amountHtCents: signedCents,
        }),
      )
      .max(1000),
    charges: z
      .array(
        z.object({
          id: z.string().uuid(),
          label: z.string().trim().min(1).max(180),
          amountHtCents: signedCents,
          /** Destination keys; empty array means all rows. Includes delivery and negative discounts. */
          destinationKeys: z.array(z.string().min(1).max(100)).max(100),
        }),
      )
      .max(100),
    orderLinks: z
      .array(
        z.object({
          orderId: z.string().uuid(),
          appliedHtCents: nonNegativeCents,
          settle: z.boolean(),
        }),
      )
      .max(100),
    note: z.string().trim().max(2000),
  })
  .superRefine((draft, ctx) => {
    if (new Set(draft.rows.map((row) => row.id)).size !== draft.rows.length) {
      ctx.addIssue({ code: "custom", message: "INVOICE_ROW_DUPLICATE" });
    }
    if (new Set(draft.charges.map((row) => row.id)).size !== draft.charges.length) {
      ctx.addIssue({ code: "custom", message: "INVOICE_CHARGE_DUPLICATE" });
    }
    if (new Set(draft.orderLinks.map((row) => row.orderId)).size !== draft.orderLinks.length) {
      ctx.addIssue({ code: "custom", message: "INVOICE_ORDER_DUPLICATE" });
    }
    if (draft.mode === "GLOBAL" && draft.rows.some((row) => row.sourceLineId !== null)) {
      ctx.addIssue({ code: "custom", message: "INVOICE_GLOBAL_LINE_INVALID" });
    }
  });
export type InvoiceAllocationDraft = z.infer<typeof invoiceAllocationDraftSchema>;

export function destinationKey(destination: InvoiceDestination): string {
  return destination.kind === "CHANTIER" ? "CHANTIER:" + destination.chantierId : destination.kind;
}

export function euroToCents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim().replace(",", ".");
  if (!/^-?\d{1,10}(?:\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, decimals = ""] = unsigned.split(".");
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_000) return null;
  return negative ? -cents : cents;
}

export type AmountByDestination = {
  destination: InvoiceDestination;
  baseHtCents: number;
  chargesHtCents: number;
  totalHtCents: number;
};
export type AllocationCalculation = { totalHtCents: number; destinations: AmountByDestination[] };

/** Largest-remainder allocation distributes signed fees without losing a cent. */
export function distributeCharge(
  cents: number,
  weights: Array<{ key: string; weight: number }>,
): Map<string, number> {
  if (!Number.isSafeInteger(cents)) throw new Error("INVOICE_CHARGE_INVALID");
  if (cents === 0) return new Map(weights.map((row) => [row.key, 0]));
  const candidates = weights.filter((row) => row.weight > 0 && Number.isSafeInteger(row.weight));
  const totalWeight = candidates.reduce((sum, row) => sum + row.weight, 0);
  if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) {
    throw new Error("INVOICE_CHARGE_NO_DESTINATION");
  }
  const absolute = Math.abs(cents);
  const shares = candidates.map((row) => ({
    key: row.key,
    amount: Math.floor((absolute * row.weight) / totalWeight),
    fraction: ((absolute * row.weight) / totalWeight) % 1,
  }));
  let rest = absolute - shares.reduce((sum, row) => sum + row.amount, 0);
  for (const row of [...shares].sort(
    (a, b) => b.fraction - a.fraction || a.key.localeCompare(b.key),
  )) {
    if (rest === 0) break;
    row.amount += 1;
    rest -= 1;
  }
  return new Map(shares.map((row) => [row.key, Math.sign(cents) * row.amount]));
}

export function calculateInvoiceAllocation(draft: InvoiceAllocationDraft): AllocationCalculation {
  const valid = invoiceAllocationDraftSchema.parse(draft);
  const groups = new Map<string, AmountByDestination>();
  for (const row of valid.rows) {
    const key = destinationKey(row.destination);
    const current = groups.get(key) ?? {
      destination: row.destination,
      baseHtCents: 0,
      chargesHtCents: 0,
      totalHtCents: 0,
    };
    current.baseHtCents += row.amountHtCents;
    groups.set(key, current);
  }
  for (const charge of valid.charges) {
    const selected = [...groups.entries()].filter(
      ([key]) => charge.destinationKeys.length === 0 || charge.destinationKeys.includes(key),
    );
    if (charge.destinationKeys.some((key) => !groups.has(key))) {
      throw new Error("INVOICE_CHARGE_DESTINATION_UNKNOWN");
    }
    const shares = distributeCharge(
      charge.amountHtCents,
      selected.map(([key, value]) => ({ key, weight: Math.abs(value.baseHtCents) })),
    );
    for (const [key, amount] of shares) groups.get(key)!.chargesHtCents += amount;
  }
  const destinations = [...groups.values()].map((row) => ({
    ...row,
    totalHtCents: row.baseHtCents + row.chargesHtCents,
  }));
  const totalHtCents = destinations.reduce((sum, row) => sum + row.totalHtCents, 0);
  if (!Number.isSafeInteger(totalHtCents)) throw new Error("INVOICE_TOTAL_INVALID");
  return { totalHtCents, destinations };
}

export function assertInvoiceComplete(draft: InvoiceAllocationDraft, invoiceAmountCents: number) {
  const result = calculateInvoiceAllocation(draft);
  if (result.destinations.length === 0 || result.totalHtCents !== invoiceAmountCents) {
    throw new Error("INVOICE_ALLOCATION_INCOMPLETE");
  }
  return result;
}

export function supplierKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]/g, "");
}

/** Accounting acceptance is separate from PAPOT allocation acceptance. */
export function invoiceIsAccountValidated(value: unknown): boolean {
  return value === "complete";
}

export type InvoiceSource = {
  id: string;
  supplierId: string | null;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  amountHtCents: number | null;
  accountingStatus: string;
  hasPdf: boolean;
  sourceRevision: string;
};

/** Deliberately excludes payment status, so paying a bill never reopens its allocation. */
export function sourceRevision(value: {
  invoiceNumber: string;
  supplierId: string | null;
  amountHtCents: number | null;
  invoiceDate: string | null;
  filename: string | null;
}): string {
  return JSON.stringify([
    value.invoiceNumber,
    value.supplierId,
    value.amountHtCents,
    value.invoiceDate,
    value.filename,
  ]);
}

export type ApprovedInvoiceAllocation = {
  draft: InvoiceAllocationDraft;
  amountHtCents: number;
  sourceRevision: string;
  validatedAt: string;
  validatedBy: string;
};

export type InvoiceAllocationState = {
  invoiceId: string;
  version: number;
  draft: InvoiceAllocationDraft | null;
  approved: ApprovedInvoiceAllocation | null;
  history: Array<{
    at: string;
    actor: string;
    action: "SAVE" | "VALIDATE";
    version: number;
  }>;
  updatedAt: string;
};

export function invoiceWorkflowState(
  source: InvoiceSource,
  state: InvoiceAllocationState | null,
): "TO_ALLOCATE" | "DRAFT" | "AWAITING_PENNYLANE" | "VALIDATED" | "REVALIDATION" {
  if (!state) return "TO_ALLOCATE";
  if (state.approved) {
    if (
      state.approved.sourceRevision !== source.sourceRevision ||
      (state.draft !== null && JSON.stringify(state.draft) !== JSON.stringify(state.approved.draft))
    )
      return "REVALIDATION";
    if (!invoiceIsAccountValidated(source.accountingStatus)) return "AWAITING_PENNYLANE";
    return "VALIDATED";
  }
  return state.draft ? "DRAFT" : "TO_ALLOCATE";
}
