import { z } from "zod";
import type { CompanyProfile } from "../company-profile/domain";
import type { ClientRecord } from "../clients/domain";
import type { BillingPayload } from "./domain";
import {
  emptyNativeInvoiceLedger,
  issueNativeInvoice,
  nativeInvoiceLedgerSchema,
  type IssueNativeInvoiceInput,
  type NativeIssuedInvoice,
} from "./native-issuance";
import {
  emptyNativeCreditNoteLedger,
  issueNativeCreditNote,
  nativeCreditNoteLedgerSchema,
  nativeInvoiceNetPosition,
  type IssueNativeCreditNoteInput,
  type NativeCreditNote,
} from "./native-credit-notes";

/**
 * STRICTLY ISOLATED sandbox. These records never enter nativeInvoiceLedger,
 * nativeCreditNoteLedger, Pennylane, or the immutable fiscal PDF archive.
 * Their PA/AV-looking numbers are only local exercise counters, not legal numbers.
 */
export const billingTestSandboxSchema = z.object({
  invoiceLedger: nativeInvoiceLedgerSchema,
  creditLedger: nativeCreditNoteLedgerSchema,
  updatedAt: z.string().datetime({ offset: true }).nullable(),
  resetCount: z.number().int().nonnegative().safe(),
  lastResetAt: z.string().datetime({ offset: true }).nullable(),
  lastResetByName: z.string().nullable(),
});
export type BillingTestSandbox = z.infer<typeof billingTestSandboxSchema>;

export function emptyBillingTestSandbox(): BillingTestSandbox {
  return {
    invoiceLedger: emptyNativeInvoiceLedger(),
    creditLedger: emptyNativeCreditNoteLedger(),
    updatedAt: null,
    resetCount: 0,
    lastResetAt: null,
    lastResetByName: null,
  };
}

function isolatedPayload(payload: BillingPayload): BillingPayload {
  const test = payload.testSandbox ?? emptyBillingTestSandbox();
  return {
    ...payload,
    testSandbox: undefined,
    nativeInvoiceLedger: test.invoiceLedger,
    nativeCreditNoteLedger: test.creditLedger,
    financialLedger: undefined,
  };
}

export function simulateBillingTestInvoice(
  payload: BillingPayload,
  input: IssueNativeInvoiceInput,
  profile: CompanyProfile,
  client: ClientRecord,
  actorName: string,
  now = new Date(),
): BillingPayload {
  const copy = issueNativeInvoice(isolatedPayload(payload), input, profile, client, actorName, now);
  const test = payload.testSandbox ?? emptyBillingTestSandbox();
  if (!copy.nativeInvoiceLedger) throw new Error("BILLING_TEST_INVOICE_MISSING");
  return {
    ...payload,
    testSandbox: {
      ...test,
      invoiceLedger: copy.nativeInvoiceLedger,
      updatedAt: now.toISOString(),
    },
  };
}

export function simulateBillingTestCredit(
  payload: BillingPayload,
  input: IssueNativeCreditNoteInput,
  actorName: string,
  now = new Date(),
): BillingPayload {
  const copy = issueNativeCreditNote(isolatedPayload(payload), input, actorName, now);
  const test = payload.testSandbox ?? emptyBillingTestSandbox();
  if (!copy.nativeCreditNoteLedger) throw new Error("BILLING_TEST_CREDIT_MISSING");
  return {
    ...payload,
    testSandbox: {
      ...test,
      creditLedger: copy.nativeCreditNoteLedger,
      updatedAt: now.toISOString(),
    },
  };
}

export const TEST_RESET_CONFIRMATION = "EFFACER LES ESSAIS";

/**
 * Only the isolated simulated records and their counters can be reset.
 * All official documents, drafts, posted financial records and archives are untouched.
 */
export function resetBillingTestSandbox(
  payload: BillingPayload,
  typedConfirmation: string,
  actorName: string,
  now = new Date(),
): BillingPayload {
  if (typedConfirmation !== TEST_RESET_CONFIRMATION) {
    throw new Error("BILLING_TEST_CONFIRMATION_REQUIRED");
  }
  return {
    ...payload,
    testSandbox: {
      ...emptyBillingTestSandbox(),
      resetCount: (payload.testSandbox?.resetCount ?? 0) + 1,
      lastResetAt: now.toISOString(),
      lastResetByName: actorName,
    },
  };
}

export type BillingTestInvoiceSummary = {
  id: string;
  draftId: string;
  number: string;
  issuedOn: string;
  totalTtcCents: number;
  clientName: string;
  taxGroups: NativeIssuedInvoice["taxGroups"];
  remainingTtcCents: number;
  remainingHtByRate: Array<{
    ratePercent: number;
    remainingHtCents: number;
  }>;
};
export type BillingTestCreditSummary = {
  id: string;
  number: string;
  originalInvoiceId: string;
  totalTtcCents: number;
  reason: string;
};

export function summarizeBillingTestSandbox(payload: BillingPayload): {
  mode: "TEST_ONLY";
  resetCount: number;
  lastResetAt: string | null;
  lastResetByName: string | null;
  invoices: BillingTestInvoiceSummary[];
  credits: BillingTestCreditSummary[];
} {
  const test = payload.testSandbox ?? emptyBillingTestSandbox();
  const simulated: BillingPayload = {
    schemaVersion: 1,
    drafts: [],
    nativeInvoiceLedger: test.invoiceLedger,
    nativeCreditNoteLedger: test.creditLedger,
  };
  return {
    mode: "TEST_ONLY",
    resetCount: test.resetCount,
    lastResetAt: test.lastResetAt,
    lastResetByName: test.lastResetByName,
    invoices: test.invoiceLedger.invoices.map((item) => {
      const position = nativeInvoiceNetPosition(simulated, item.id);
      return {
        id: item.id,
        draftId: item.draftId,
        number: "TEST-" + item.number,
        issuedOn: item.issuedOn,
        totalTtcCents: item.totalTtcCents,
        clientName: item.buyer.name,
        taxGroups: item.taxGroups,
        remainingTtcCents: position.remainingTtcCents,
        remainingHtByRate: position.allowances.map((group) => ({
          ratePercent: group.ratePercent,
          remainingHtCents: group.remainingHtCents,
        })),
      };
    }),
    credits: test.creditLedger.creditNotes.map((note) => ({
      id: note.id,
      number: "TEST-" + note.number,
      originalInvoiceId: note.originalInvoiceId,
      totalTtcCents: note.totalTtcCents,
      reason: note.reason,
    })),
  };
}

export function findBillingTestDocument(
  payload: BillingPayload,
  documentId: string,
): { kind: "INVOICE"; invoice: NativeIssuedInvoice } |
   { kind: "CREDIT"; credit: NativeCreditNote; original: NativeIssuedInvoice } {
  const test = payload.testSandbox ?? emptyBillingTestSandbox();
  const invoice = test.invoiceLedger.invoices.find((item) => item.id === documentId);
  if (invoice) return { kind: "INVOICE", invoice };
  const credit = test.creditLedger.creditNotes.find((item) => item.id === documentId);
  if (!credit) throw new Error("BILLING_TEST_DOCUMENT_NOT_FOUND");
  const original = test.invoiceLedger.invoices.find((item) => item.id === credit.originalInvoiceId);
  if (!original) throw new Error("BILLING_TEST_ORIGINAL_MISSING");
  return { kind: "CREDIT", credit, original };
}
