import { z } from "zod";
import type { BillingDraft } from "./domain";

const moneySchema = z.number().int().nonnegative().safe();
const positiveMoneySchema = moneySchema.positive();
const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "BILLING_FINANCIAL_DATE_INVALID");

const taxGroupSchema = z.object({
  ratePercent: z.number().finite().min(0).max(100),
  baseHtCents: moneySchema,
  vatCents: moneySchema,
});

const issuedInvoiceSchema = z.object({
  id: z.string().uuid(),
  draftId: z.string().uuid(),
  chantierId: z.string().uuid(),
  clientId: z.string().uuid(),
  pennylaneId: z.string().trim().min(1).max(160),
  number: z.string().trim().min(1).max(160),
  issuedOn: calendarDateSchema,
  dueOn: calendarDateSchema,
  taxGroups: z.array(taxGroupSchema).min(1),
  amountHtCents: positiveMoneySchema,
  vatCents: moneySchema,
  totalTtcCents: positiveMoneySchema,
  retentionTtcCents: moneySchema,
});

const issuedCreditNoteSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  pennylaneId: z.string().trim().min(1).max(160),
  number: z.string().trim().min(1).max(160),
  issuedOn: calendarDateSchema,
  reason: z.string().trim().min(1).max(2000),
  taxGroups: z.array(taxGroupSchema).min(1),
  totalTtcCents: positiveMoneySchema,
});

const bankPaymentSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  bankMovementId: z.string().trim().min(1).max(160),
  kind: z.enum(["STANDARD", "RETENTION"]),
  amountTtcCents: positiveMoneySchema,
  paidOn: calendarDateSchema,
});

const closingDateSchema = z.object({
  chantierId: z.string().uuid(),
  lastInvoiceOn: calendarDateSchema,
  updatedAt: z.string().datetime({ offset: true }),
  updatedByName: z.string().trim().min(1).max(160),
});

const retentionClaimSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  claimedOn: calendarDateSchema,
  note: z.string().trim().max(2000),
  claimedByName: z.string().trim().min(1).max(160),
});

const retentionAbandonmentSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid(),
  abandonedOn: calendarDateSchema,
  reason: z.string().trim().min(1).max(2000),
  abandonedByName: z.string().trim().min(1).max(160),
});

export const billingFinancialLedgerSchema = z.object({
  invoices: z.array(issuedInvoiceSchema),
  creditNotes: z.array(issuedCreditNoteSchema),
  bankPayments: z.array(bankPaymentSchema),
  closingDates: z.array(closingDateSchema),
  retentionClaims: z.array(retentionClaimSchema),
  retentionAbandonments: z.array(retentionAbandonmentSchema),
});

export type BillingFinancialLedger = z.infer<typeof billingFinancialLedgerSchema>;
export type BillingIssuedInvoice = BillingFinancialLedger["invoices"][number];
export type BillingIssuedCreditNote = BillingFinancialLedger["creditNotes"][number];
export type BillingBankPayment = BillingFinancialLedger["bankPayments"][number];

export function emptyBillingFinancialLedger(): BillingFinancialLedger {
  return {
    invoices: [],
    creditNotes: [],
    bankPayments: [],
    closingDates: [],
    retentionClaims: [],
    retentionAbandonments: [],
  };
}

function safeTotal(values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new Error("BILLING_FINANCIAL_AMOUNT_INVALID");
  return total;
}

function totalsForGroups(groups: BillingIssuedInvoice["taxGroups"]) {
  const ht = safeTotal(groups.map((group) => group.baseHtCents));
  const vat = safeTotal(groups.map((group) => group.vatCents));
  return { ht, vat, ttc: safeTotal([ht, vat]) };
}

function compareTaxGroups(
  actual: BillingIssuedInvoice["taxGroups"],
  expected: BillingDraft["taxGroups"],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((group) =>
      expected.some(
        (item) =>
          item.ratePercent === group.ratePercent &&
          item.baseHtCents === group.baseHtCents &&
          item.vatCents === group.vatCents,
      ),
    )
  );
}

/**
 * Only a confirmed Pennylane invoice can enter the issued ledger.
 * An internally APPROVED project is never itself considered an issued invoice.
 * The caller must verify the Pennylane response, company and API scopes.
 */
export function registerConfirmedInvoice(
  ledger: BillingFinancialLedger,
  invoiceInput: BillingIssuedInvoice,
  internalDraft: BillingDraft,
): BillingFinancialLedger {
  const invoice = issuedInvoiceSchema.parse(invoiceInput);
  if (
    internalDraft.status !== "APPROVED" ||
    internalDraft.id !== invoice.draftId ||
    internalDraft.chantierId !== invoice.chantierId ||
    internalDraft.clientId !== invoice.clientId ||
    !compareTaxGroups(invoice.taxGroups, internalDraft.taxGroups) ||
    invoice.amountHtCents !== internalDraft.amountHtCents ||
    invoice.vatCents !== internalDraft.vatCents ||
    invoice.totalTtcCents !== internalDraft.totalTtcCents
  ) {
    throw new Error("BILLING_FINANCIAL_SOURCE_NOT_APPROVED");
  }
  const sums = totalsForGroups(invoice.taxGroups);
  if (
    sums.ht !== invoice.amountHtCents ||
    sums.vat !== invoice.vatCents ||
    sums.ttc !== invoice.totalTtcCents ||
    invoice.retentionTtcCents > invoice.totalTtcCents
  ) {
    throw new Error("BILLING_FINANCIAL_TOTALS_MISMATCH");
  }
  if (
    ledger.invoices.some(
      (existing) =>
        existing.id === invoice.id ||
        existing.draftId === invoice.draftId ||
        existing.pennylaneId === invoice.pennylaneId ||
        existing.number === invoice.number,
    )
  ) {
    throw new Error("BILLING_FINANCIAL_INVOICE_DUPLICATE");
  }
  return { ...ledger, invoices: [...ledger.invoices, invoice] };
}

function findInvoice(ledger: BillingFinancialLedger, invoiceId: string): BillingIssuedInvoice {
  const invoice = ledger.invoices.find((item) => item.id === invoiceId);
  if (!invoice) throw new Error("BILLING_FINANCIAL_INVOICE_NOT_FOUND");
  return invoice;
}

export function invoiceFinancialPosition(ledger: BillingFinancialLedger, invoiceId: string) {
  const invoice = findInvoice(ledger, invoiceId);
  const credits = ledger.creditNotes.filter((item) => item.invoiceId === invoiceId);
  const totalCreditedCents = safeTotal(credits.map((item) => item.totalTtcCents));
  const netTtcCents = invoice.totalTtcCents - totalCreditedCents;
  const immediatePaymentsCents = safeTotal(
    ledger.bankPayments
      .filter((item) => item.invoiceId === invoiceId && item.kind === "STANDARD")
      .map((item) => item.amountTtcCents),
  );
  const retentionPaymentsCents = safeTotal(
    ledger.bankPayments
      .filter((item) => item.invoiceId === invoiceId && item.kind === "RETENTION")
      .map((item) => item.amountTtcCents),
  );
  const immediatelyDueCents = Math.max(0, netTtcCents - invoice.retentionTtcCents);
  return {
    invoice,
    netTtcCents,
    totalCreditedCents,
    immediatelyDueCents,
    immediatelyOutstandingCents: Math.max(0, immediatelyDueCents - immediatePaymentsCents),
    retentionOutstandingCents: Math.max(0, invoice.retentionTtcCents - retentionPaymentsCents),
    excessPaidCents: Math.max(
      0,
      immediatePaymentsCents + retentionPaymentsCents - netTtcCents,
    ),
  };
}

/** A credit is registered only after Pennylane has actually issued it. */
export function registerConfirmedCreditNote(
  ledger: BillingFinancialLedger,
  input: BillingIssuedCreditNote,
): BillingFinancialLedger {
  const credit = issuedCreditNoteSchema.parse(input);
  const invoice = findInvoice(ledger, credit.invoiceId);
  if (
    ledger.creditNotes.some(
      (item) =>
        item.id === credit.id ||
        item.pennylaneId === credit.pennylaneId ||
        item.number === credit.number,
    )
  ) {
    throw new Error("BILLING_FINANCIAL_CREDIT_DUPLICATE");
  }
  const totals = totalsForGroups(credit.taxGroups);
  if (totals.ttc !== credit.totalTtcCents) {
    throw new Error("BILLING_FINANCIAL_CREDIT_TOTALS_MISMATCH");
  }
  // Aggregate by VAT rate before validating: a single credit may contain
  // several rows of the same rate, and they must share the same ceiling.
  const rates = new Set(credit.taxGroups.map((group) => group.ratePercent));
  for (const rate of rates) {
    const original = invoice.taxGroups.filter((group) => group.ratePercent === rate);
    const previous = ledger.creditNotes
      .filter((item) => item.invoiceId === credit.invoiceId)
      .flatMap((item) => item.taxGroups)
      .filter((item) => item.ratePercent === rate);
    const current = credit.taxGroups.filter((group) => group.ratePercent === rate);
    if (
      original.length === 0 ||
      safeTotal([...previous, ...current].map((item) => item.baseHtCents)) >
        safeTotal(original.map((item) => item.baseHtCents)) ||
      safeTotal([...previous, ...current].map((item) => item.vatCents)) >
        safeTotal(original.map((item) => item.vatCents))
    ) {
      throw new Error("BILLING_FINANCIAL_CREDIT_EXCEEDS_INVOICE");
    }
  }
  const net = invoice.totalTtcCents - safeTotal([
    ...ledger.creditNotes
      .filter((item) => item.invoiceId === invoice.id)
      .map((item) => item.totalTtcCents),
    credit.totalTtcCents,
  ]);
  if (net < invoice.retentionTtcCents) {
    throw new Error("BILLING_FINANCIAL_CREDIT_REQUIRES_RETENTION_REVIEW");
  }
  return { ...ledger, creditNotes: [...ledger.creditNotes, credit] };
}

/** The caller must verify the actual bank transaction before using this function. */
export function reconcileConfirmedBankPayment(
  ledger: BillingFinancialLedger,
  input: BillingBankPayment,
): BillingFinancialLedger {
  const payment = bankPaymentSchema.parse(input);
  const position = invoiceFinancialPosition(ledger, payment.invoiceId);
  if (
    ledger.bankPayments.some(
      (item) =>
        item.id === payment.id ||
        (item.bankMovementId === payment.bankMovementId &&
          item.invoiceId === payment.invoiceId &&
          item.kind === payment.kind),
    )
  ) {
    throw new Error("BILLING_FINANCIAL_BANK_DUPLICATE");
  }
  const remaining =
    payment.kind === "RETENTION"
      ? position.retentionOutstandingCents
      : position.immediatelyOutstandingCents;
  if (payment.amountTtcCents > remaining) {
    throw new Error("BILLING_FINANCIAL_PAYMENT_EXCEEDS_BALANCE");
  }
  return { ...ledger, bankPayments: [...ledger.bankPayments, payment] };
}

export function setChantierLastInvoiceDate(
  ledger: BillingFinancialLedger,
  chantierId: string,
  lastInvoiceOn: string,
  actorName: string,
  now = new Date(),
): BillingFinancialLedger {
  const closingDate = closingDateSchema.parse({
    chantierId,
    lastInvoiceOn,
    updatedAt: now.toISOString(),
    updatedByName: actorName,
  });
  if (
    ledger.invoices.some(
      (item) => item.chantierId === chantierId && item.issuedOn > closingDate.lastInvoiceOn,
    )
  ) {
    throw new Error("BILLING_FINANCIAL_CLOSING_DATE_BEFORE_INVOICE");
  }
  return {
    ...ledger,
    closingDates: [
      ...ledger.closingDates.filter((item) => item.chantierId !== chantierId),
      closingDate,
    ],
  };
}

function addOneYear(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year + 1, month, 0)).getUTCDate();
  return new Date(Date.UTC(year + 1, month - 1, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

export function retentionPosition(
  ledger: BillingFinancialLedger,
  invoiceId: string,
  asOf: string,
) {
  const date = calendarDateSchema.parse(asOf);
  const position = invoiceFinancialPosition(ledger, invoiceId);
  const invoice = position.invoice;
  if (invoice.retentionTtcCents === 0) return null;
  const closure = ledger.closingDates.find((item) => item.chantierId === invoice.chantierId);
  const dueOn = closure ? addOneYear(closure.lastInvoiceOn) : null;
  const abandoned = ledger.retentionAbandonments.some((item) => item.invoiceId === invoiceId);
  const claimed = ledger.retentionClaims.some((item) => item.invoiceId === invoiceId);
  const thirtyDaysAhead = new Date(date + "T00:00:00.000Z");
  thirtyDaysAhead.setUTCDate(thirtyDaysAhead.getUTCDate() + 30);
  const upcomingLimit = thirtyDaysAhead.toISOString().slice(0, 10);
  const status = abandoned
    ? "ABANDONED"
    : position.retentionOutstandingCents === 0
      ? "COLLECTED"
      : !dueOn
        ? "WAITING_CLOSURE"
        : dueOn <= date
          ? claimed
            ? "CLAIMED"
            : "TO_CLAIM"
          : dueOn <= upcomingLimit
            ? "UPCOMING"
            : "WAITING";
  return {
    invoiceId,
    chantierId: invoice.chantierId,
    dueOn,
    lastInvoiceOn: closure?.lastInvoiceOn ?? null,
    totalTtcCents: invoice.retentionTtcCents,
    outstandingTtcCents: position.retentionOutstandingCents,
    status,
  };
}

export function recordRetentionClaim(
  ledger: BillingFinancialLedger,
  input: z.infer<typeof retentionClaimSchema>,
): BillingFinancialLedger {
  const claim = retentionClaimSchema.parse(input);
  const position = retentionPosition(ledger, claim.invoiceId, claim.claimedOn);
  if (!position || position.status !== "TO_CLAIM") {
    throw new Error("BILLING_FINANCIAL_RETENTION_NOT_CLAIMABLE");
  }
  return { ...ledger, retentionClaims: [...ledger.retentionClaims, claim] };
}

export function abandonRetention(
  ledger: BillingFinancialLedger,
  input: z.infer<typeof retentionAbandonmentSchema>,
): BillingFinancialLedger {
  const abandonment = retentionAbandonmentSchema.parse(input);
  const position = retentionPosition(ledger, abandonment.invoiceId, abandonment.abandonedOn);
  if (
    !position ||
    position.status === "COLLECTED" ||
    position.status === "ABANDONED"
  ) {
    throw new Error("BILLING_FINANCIAL_RETENTION_NOT_ABANDONABLE");
  }
  return {
    ...ledger,
    retentionAbandonments: [...ledger.retentionAbandonments, abandonment],
  };
}

/** Never projects draft/APPROVED projects as bank receipts. */
export function forecastConfirmedReceipts(
  ledger: BillingFinancialLedger,
  asOf: string,
): Array<{
  invoiceId: string;
  type: "INVOICE" | "RETENTION";
  dueOn: string;
  amountTtcCents: number;
}> {
  calendarDateSchema.parse(asOf);
  return ledger.invoices.flatMap((invoice) => {
    const position = invoiceFinancialPosition(ledger, invoice.id);
    const retention = retentionPosition(ledger, invoice.id, asOf);
    const rows: Array<{
      invoiceId: string;
      type: "INVOICE" | "RETENTION";
      dueOn: string;
      amountTtcCents: number;
    }> = [];
    if (position.immediatelyOutstandingCents > 0) {
      rows.push({
        invoiceId: invoice.id,
        type: "INVOICE",
        dueOn: invoice.dueOn,
        amountTtcCents: position.immediatelyOutstandingCents,
      });
    }
    if (
      retention?.dueOn &&
      retention.outstandingTtcCents > 0 &&
      retention.status !== "ABANDONED"
    ) {
      rows.push({
        invoiceId: invoice.id,
        type: "RETENTION",
        dueOn: retention.dueOn,
        amountTtcCents: retention.outstandingTtcCents,
      });
    }
    return rows;
  });
}
