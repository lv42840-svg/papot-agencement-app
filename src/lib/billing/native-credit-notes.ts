import { z } from "zod";
import type { BillingPayload } from "./domain";
import { assertNativeInvoiceSequence, type NativeIssuedInvoice } from "./native-issuance";

const cents = z.number().int().nonnegative().safe();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(value + "T00:00:00.000Z");
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, "BILLING_NATIVE_CREDIT_DATE_INVALID");
const taxGroupSchema = z.object({
  ratePercent: z.number().finite().min(0).max(100),
  baseHtCents: cents.positive(),
  vatCents: cents,
});

export const nativeCreditNoteSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  originalInvoiceId: z.string().uuid(),
  originalInvoiceNumber: z.string().min(1),
  originalInvoiceIssuedOn: dateSchema,
  clientId: z.string().uuid(),
  ordinal: z.number().int().positive().safe(),
  number: z.string().regex(/^AV-\d{4}-\d{6,}$/),
  issuedAt: z.string().datetime({ offset: true }),
  issuedOn: dateSchema,
  mode: z.enum(["FULL", "PARTIAL"]),
  reason: z.string().trim().min(3).max(2000),
  taxGroups: z.array(taxGroupSchema).min(1),
  amountHtCents: cents.positive(),
  vatCents: cents,
  totalTtcCents: cents.positive(),
  issuedByName: z.string().trim().min(1),
  status: z.literal("ISSUED"),
});
export type NativeCreditNote = z.infer<typeof nativeCreditNoteSchema>;

export const nativeCreditNoteLedgerSchema = z.object({
  lastOrdinal: z.number().int().nonnegative().safe(),
  creditNotes: z.array(nativeCreditNoteSchema),
});
export type NativeCreditNoteLedger = z.infer<typeof nativeCreditNoteLedgerSchema>;

export function emptyNativeCreditNoteLedger(): NativeCreditNoteLedger {
  return { lastOrdinal: 0, creditNotes: [] };
}

export const issueNativeCreditNoteInputSchema = z
  .object({
    requestId: z.string().uuid(),
    originalInvoiceId: z.string().uuid(),
    mode: z.enum(["FULL", "PARTIAL"]),
    reason: z.string().trim().min(3).max(2000),
    amounts: z
      .array(
        z
          .object({
            ratePercent: z.number().finite().min(0).max(100),
            baseHtCents: cents.positive(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export type IssueNativeCreditNoteInput = z.infer<typeof issueNativeCreditNoteInputSchema>;

function safeSum(values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new Error("BILLING_NATIVE_CREDIT_AMOUNT_INVALID");
  return total;
}

function parisDate(now: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return [parts.year, parts.month, parts.day].join("-");
}

export function assertNativeCreditNoteSequence(ledger: NativeCreditNoteLedger): void {
  if (ledger.lastOrdinal !== ledger.creditNotes.length) {
    throw new Error("BILLING_NATIVE_CREDIT_SEQUENCE_CORRUPT");
  }
  const requestIds = new Set<string>();
  const noteIds = new Set<string>();
  let lastIssued = "";
  ledger.creditNotes.forEach((note, index) => {
    const ordinal = index + 1;
    const expectedNumber = ["AV", note.issuedOn.slice(0, 4), String(ordinal).padStart(6, "0")].join(
      "-",
    );
    if (
      note.ordinal !== ordinal ||
      note.number !== expectedNumber ||
      note.issuedAt < lastIssued ||
      requestIds.has(note.requestId) ||
      noteIds.has(note.id)
    ) {
      throw new Error("BILLING_NATIVE_CREDIT_SEQUENCE_CORRUPT");
    }
    lastIssued = note.issuedAt;
    requestIds.add(note.requestId);
    noteIds.add(note.id);
  });
}

export type NativeCreditAllowance = {
  ratePercent: number;
  originalHtCents: number;
  originalVatCents: number;
  creditedHtCents: number;
  creditedVatCents: number;
  remainingHtCents: number;
  remainingVatCents: number;
};

export function nativeCreditAllowances(
  invoice: NativeIssuedInvoice,
  credits: NativeCreditNote[],
): NativeCreditAllowance[] {
  const groups = new Map<number, { ht: number; vat: number }>();
  for (const group of invoice.taxGroups) {
    const current = groups.get(group.ratePercent) ?? { ht: 0, vat: 0 };
    groups.set(group.ratePercent, {
      ht: safeSum([current.ht, group.baseHtCents]),
      vat: safeSum([current.vat, group.vatCents]),
    });
  }
  const used = new Map<number, { ht: number; vat: number }>();
  for (const credit of credits) {
    if (
      credit.originalInvoiceId !== invoice.id ||
      credit.originalInvoiceNumber !== invoice.number ||
      credit.originalInvoiceIssuedOn !== invoice.issuedOn ||
      credit.clientId !== invoice.clientId
    ) {
      throw new Error("BILLING_NATIVE_CREDIT_SOURCE_CORRUPT");
    }
    for (const group of credit.taxGroups) {
      const current = used.get(group.ratePercent) ?? { ht: 0, vat: 0 };
      used.set(group.ratePercent, {
        ht: safeSum([current.ht, group.baseHtCents]),
        vat: safeSum([current.vat, group.vatCents]),
      });
    }
  }
  if ([...used.keys()].some((rate) => !groups.has(rate))) {
    throw new Error("BILLING_NATIVE_CREDIT_SOURCE_CORRUPT");
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, original]) => {
      const credited = used.get(rate) ?? { ht: 0, vat: 0 };
      if (credited.ht > original.ht || credited.vat > original.vat) {
        throw new Error("BILLING_NATIVE_CREDIT_EXCEEDS_ORIGINAL");
      }
      return {
        ratePercent: rate,
        originalHtCents: original.ht,
        originalVatCents: original.vat,
        creditedHtCents: credited.ht,
        creditedVatCents: credited.vat,
        remainingHtCents: original.ht - credited.ht,
        remainingVatCents: original.vat - credited.vat,
      };
    });
}

/**
 * The invoice is never modified. A credit has its own independent numbering
 * sequence and carries positive amounts representing a deduction from revenue.
 * No Pennylane write, bank movement or customer refund is created here.
 */
export function issueNativeCreditNote(
  payload: BillingPayload,
  rawInput: IssueNativeCreditNoteInput,
  actorName: string,
  now = new Date(),
): BillingPayload {
  const input = issueNativeCreditNoteInputSchema.parse(rawInput);
  const invoices = payload.nativeInvoiceLedger;
  if (!invoices) throw new Error("BILLING_NATIVE_CREDIT_ORIGINAL_NOT_FOUND");
  assertNativeInvoiceSequence(invoices);
  const ledger = payload.nativeCreditNoteLedger ?? emptyNativeCreditNoteLedger();
  assertNativeCreditNoteSequence(ledger);
  const replay = ledger.creditNotes.find((item) => item.requestId === input.requestId);
  if (replay) {
    const matchingAmounts =
      replay.taxGroups.length === input.amounts.length &&
      input.amounts.every((amount) =>
        replay.taxGroups.some(
          (group) =>
            group.ratePercent === amount.ratePercent && group.baseHtCents === amount.baseHtCents,
        ),
      );
    if (
      replay.originalInvoiceId !== input.originalInvoiceId ||
      replay.mode !== input.mode ||
      replay.reason !== input.reason ||
      !matchingAmounts
    ) {
      throw new Error("BILLING_NATIVE_CREDIT_REQUEST_REUSED");
    }
    return payload;
  }
  const original = invoices.invoices.find((item) => item.id === input.originalInvoiceId);
  if (!original) throw new Error("BILLING_NATIVE_CREDIT_ORIGINAL_NOT_FOUND");
  if (!Number.isFinite(now.valueOf())) throw new Error("BILLING_NATIVE_CREDIT_DATE_INVALID");
  const issuedAt = now.toISOString();
  const issuedOn = parisDate(now);
  if (
    issuedOn < original.issuedOn ||
    (ledger.creditNotes.length && ledger.creditNotes.at(-1)!.issuedAt > issuedAt)
  ) {
    throw new Error("BILLING_NATIVE_CREDIT_DATE_BACKWARDS");
  }
  const relevant = ledger.creditNotes.filter((item) => item.originalInvoiceId === original.id);
  const allowances = nativeCreditAllowances(original, relevant);
  const inputs = new Map<number, number>();
  for (const amount of input.amounts) {
    if (inputs.has(amount.ratePercent)) {
      throw new Error("BILLING_NATIVE_CREDIT_DUPLICATE_VAT");
    }
    inputs.set(amount.ratePercent, amount.baseHtCents);
  }
  if (
    input.mode === "FULL" &&
    allowances.some(
      (available) =>
        available.remainingHtCents > 0 &&
        inputs.get(available.ratePercent) !== available.remainingHtCents,
    )
  ) {
    throw new Error("BILLING_NATIVE_CREDIT_FULL_AMOUNT_REQUIRED");
  }
  const creditGroups: NativeCreditNote["taxGroups"] = [];
  for (const [rate, requestedHt] of inputs) {
    const available = allowances.find((item) => item.ratePercent === rate);
    if (
      !available ||
      requestedHt > available.remainingHtCents ||
      available.remainingHtCents === 0
    ) {
      throw new Error("BILLING_NATIVE_CREDIT_EXCEEDS_ORIGINAL");
    }
    // A final reduction consumes the exact original VAT remainder, including
    // the rounding cent from the original invoice or earlier partial credits.
    const vat =
      requestedHt === available.remainingHtCents
        ? available.remainingVatCents
        : Math.round((requestedHt * rate) / 100);
    if (vat > available.remainingVatCents) {
      throw new Error("BILLING_NATIVE_CREDIT_VAT_EXCEEDS_ORIGINAL");
    }
    creditGroups.push({ ratePercent: rate, baseHtCents: requestedHt, vatCents: vat });
  }
  if (
    input.mode === "FULL" &&
    creditGroups.length !== allowances.filter((available) => available.remainingHtCents > 0).length
  )
    throw new Error("BILLING_NATIVE_CREDIT_FULL_AMOUNT_REQUIRED");
  const amountHtCents = safeSum(creditGroups.map((group) => group.baseHtCents));
  const vatCents = safeSum(creditGroups.map((group) => group.vatCents));
  const totalTtcCents = safeSum([amountHtCents, vatCents]);
  const ordinal = ledger.lastOrdinal + 1;
  if (!Number.isSafeInteger(ordinal)) throw new Error("BILLING_NATIVE_CREDIT_SEQUENCE_EXHAUSTED");
  const number = ["AV", issuedOn.slice(0, 4), String(ordinal).padStart(6, "0")].join("-");
  if (
    invoices.invoices.some((item) => item.number === number) ||
    ledger.creditNotes.some((item) => item.number === number)
  ) {
    throw new Error("BILLING_NATIVE_CREDIT_NUMBER_CONFLICT");
  }
  const note = nativeCreditNoteSchema.parse({
    id: crypto.randomUUID(),
    requestId: input.requestId,
    originalInvoiceId: original.id,
    originalInvoiceNumber: original.number,
    originalInvoiceIssuedOn: original.issuedOn,
    clientId: original.clientId,
    ordinal,
    number,
    issuedAt,
    issuedOn,
    mode: input.mode,
    reason: input.reason,
    taxGroups: creditGroups.sort((a, b) => a.ratePercent - b.ratePercent),
    amountHtCents,
    vatCents,
    totalTtcCents,
    issuedByName: actorName,
    status: "ISSUED",
  });
  return {
    ...payload,
    nativeCreditNoteLedger: {
      lastOrdinal: ordinal,
      creditNotes: [...ledger.creditNotes, note],
    },
  };
}

export function nativeInvoiceNetPosition(payload: BillingPayload, invoiceId: string) {
  const original = payload.nativeInvoiceLedger?.invoices.find((item) => item.id === invoiceId);
  if (!original) throw new Error("BILLING_NATIVE_CREDIT_ORIGINAL_NOT_FOUND");
  const notes = (payload.nativeCreditNoteLedger?.creditNotes ?? []).filter(
    (note) => note.originalInvoiceId === invoiceId,
  );
  const allowances = nativeCreditAllowances(original, notes);
  return {
    originalTtcCents: original.totalTtcCents,
    creditedTtcCents: safeSum(notes.map((note) => note.totalTtcCents)),
    remainingTtcCents: safeSum(
      allowances.map((group) => safeSum([group.remainingHtCents, group.remainingVatCents])),
    ),
    allowances,
  };
}
