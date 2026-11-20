import { describe, expect, it } from "vitest";
import {
  abandonRetention,
  emptyBillingFinancialLedger,
  forecastConfirmedReceipts,
  invoiceFinancialPosition,
  reconcileConfirmedBankPayment,
  recordRetentionClaim,
  registerConfirmedCreditNote,
  registerConfirmedInvoice,
  retentionPosition,
  setChantierLastInvoiceDate,
  type BillingIssuedCreditNote,
  type BillingIssuedInvoice,
} from "../src/lib/billing/financial-ledger";
import {
  approveBillingDraft,
  createBillingDraft,
  type BillingDraft,
  type BillingSource,
} from "../src/lib/billing/domain";

const chantierId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const source: BillingSource = {
  quoteId: "33333333-3333-4333-8333-333333333333",
  commercialCaseId: "44444444-4444-4444-8444-444444444444",
  chantierId,
  clientId,
  clientName: "Client test",
  affairName: "Chantier test",
  quoteLabel: "D-2026",
  contractHtCents: 100_000,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: 100_000 }],
};

function approvedDraft(): BillingDraft {
  const draft = createBillingDraft(
    { schemaVersion: 1, drafts: [] },
    source,
    { requestId: crypto.randomUUID(), type: "STANDARD" },
    "Nadia",
  );
  return approveBillingDraft(
    { schemaVersion: 1, drafts: [draft] },
    draft.id,
    draft.updatedAt,
    "Lucien",
  );
}

function issuedInvoice(
  draft: BillingDraft,
  options: Partial<BillingIssuedInvoice> = {},
): BillingIssuedInvoice {
  return {
    id: crypto.randomUUID(),
    draftId: draft.id,
    chantierId,
    clientId,
    pennylaneId: "penny-invoice-1",
    number: "FA-2026-01",
    issuedOn: "2026-11-20",
    dueOn: "2026-12-20",
    taxGroups: draft.taxGroups,
    amountHtCents: draft.amountHtCents,
    vatCents: draft.vatCents,
    totalTtcCents: draft.totalTtcCents,
    retentionTtcCents: 6_000,
    ...options,
  };
}

function credit(
  invoiceId: string,
  baseHtCents: number,
  options: Partial<BillingIssuedCreditNote> = {},
): BillingIssuedCreditNote {
  return {
    id: crypto.randomUUID(),
    invoiceId,
    pennylaneId: crypto.randomUUID(),
    number: "AV-2026-01",
    issuedOn: "2026-11-25",
    reason: "Correction prestation",
    taxGroups: [
      {
        ratePercent: 20,
        baseHtCents,
        vatCents: Math.round(baseHtCents * 0.2),
      },
    ],
    totalTtcCents: Math.round(baseHtCents * 1.2),
    ...options,
  };
}

describe("registre de facturation confirmée, séparé des projets", () => {
  it("ne confond jamais un projet approuvé avec une facture réellement émise", () => {
    const draft = approvedDraft();
    const empty = emptyBillingFinancialLedger();
    expect(forecastConfirmedReceipts(empty, "2026-11-20")).toEqual([]);
    const invoice = issuedInvoice(draft);
    const ledger = registerConfirmedInvoice(empty, invoice, draft);
    expect(ledger.invoices).toHaveLength(1);
    expect(ledger.invoices[0].pennylaneId).toBe("penny-invoice-1");
    expect(() => registerConfirmedInvoice(ledger, invoice, draft)).toThrow(
      "BILLING_FINANCIAL_INVOICE_DUPLICATE",
    );
    const other = { ...invoice, id: crypto.randomUUID(), number: "FA-2026-02" };
    expect(() => registerConfirmedInvoice(ledger, other, draft)).toThrow(
      "BILLING_FINANCIAL_INVOICE_DUPLICATE",
    );
  });

  it("refuse un brouillon ou un montant différent de l'approbation interne", () => {
    const approved = approvedDraft();
    const proposed = issuedInvoice(approved);
    expect(() =>
      registerConfirmedInvoice(
        emptyBillingFinancialLedger(),
        proposed,
        { ...approved, status: "DRAFT" },
      ),
    ).toThrow("BILLING_FINANCIAL_SOURCE_NOT_APPROVED");
    expect(() =>
      registerConfirmedInvoice(
        emptyBillingFinancialLedger(),
        { ...proposed, amountHtCents: proposed.amountHtCents - 1 },
        approved,
      ),
    ).toThrow("BILLING_FINANCIAL_SOURCE_NOT_APPROVED");
  });

  it("déduit les avoirs confirmés par taux de TVA et refuse le sur-crédit", () => {
    const draft = approvedDraft();
    const invoice = issuedInvoice(draft);
    const initial = registerConfirmedInvoice(emptyBillingFinancialLedger(), invoice, draft);
    const first = credit(invoice.id, 10_000);
    const ledger = registerConfirmedCreditNote(initial, first);
    expect(invoiceFinancialPosition(ledger, invoice.id)).toMatchObject({
      netTtcCents: 108_000,
      totalCreditedCents: 12_000,
      immediatelyOutstandingCents: 102_000,
      retentionOutstandingCents: 6_000,
    });
    expect(() => registerConfirmedCreditNote(ledger, first)).toThrow(
      "BILLING_FINANCIAL_CREDIT_DUPLICATE",
    );
    expect(() => registerConfirmedCreditNote(ledger, credit(invoice.id, 95_000))).toThrow(
      "BILLING_FINANCIAL_CREDIT_EXCEEDS_INVOICE",
    );
    expect(() =>
      registerConfirmedCreditNote(
        ledger,
        credit(invoice.id, 1_000, {
          number: "AV-2026-02",
          taxGroups: [{ ratePercent: 10, baseHtCents: 1_000, vatCents: 100 }],
          totalTtcCents: 1_100,
        }),
      ),
    ).toThrow("BILLING_FINANCIAL_CREDIT_EXCEEDS_INVOICE");
    expect(() =>
      registerConfirmedCreditNote(
        initial,
        credit(invoice.id, 100_000, {
          taxGroups: [
            { ratePercent: 20, baseHtCents: 60_000, vatCents: 12_000 },
            { ratePercent: 20, baseHtCents: 60_000, vatCents: 12_000 },
          ],
          totalTtcCents: 144_000,
        }),
      ),
    ).toThrow("BILLING_FINANCIAL_CREDIT_EXCEEDS_INVOICE");
  });

  it("suit les paiements partiels sans double rapprochement bancaire", () => {
    const draft = approvedDraft();
    const invoice = issuedInvoice(draft);
    const initial = registerConfirmedInvoice(emptyBillingFinancialLedger(), invoice, draft);
    const payment = {
      id: crypto.randomUUID(),
      invoiceId: invoice.id,
      bankMovementId: "banque-1",
      kind: "STANDARD" as const,
      amountTtcCents: 20_000,
      paidOn: "2026-12-12",
    };
    const ledger = reconcileConfirmedBankPayment(initial, payment);
    expect(invoiceFinancialPosition(ledger, invoice.id).immediatelyOutstandingCents).toBe(
      94_000,
    );
    expect(() =>
      reconcileConfirmedBankPayment(ledger, { ...payment, id: crypto.randomUUID() }),
    ).toThrow("BILLING_FINANCIAL_BANK_DUPLICATE");
    expect(() =>
      reconcileConfirmedBankPayment(ledger, {
        ...payment,
        id: crypto.randomUUID(),
        bankMovementId: "banque-2",
        amountTtcCents: 94_001,
      }),
    ).toThrow("BILLING_FINANCIAL_PAYMENT_EXCEEDS_BALANCE");
    expect(forecastConfirmedReceipts(ledger, "2026-12-15")).toEqual([
      {
        invoiceId: invoice.id,
        type: "INVOICE",
        dueOn: "2026-12-20",
        amountTtcCents: 94_000,
      },
    ]);
  });

  it("calcule l'échéance commune à un an depuis la dernière facture et l'approche à J-30", () => {
    const draft = approvedDraft();
    const invoice = issuedInvoice(draft, {
      issuedOn: "2024-02-20",
      dueOn: "2024-03-20",
    });
    const first = registerConfirmedInvoice(emptyBillingFinancialLedger(), invoice, draft);
    const ledger = setChantierLastInvoiceDate(first, chantierId, "2024-02-29", "Nadia");
    expect(retentionPosition(ledger, invoice.id, "2025-01-20")).toMatchObject({
      dueOn: "2025-02-28",
      status: "WAITING",
    });
    expect(retentionPosition(ledger, invoice.id, "2025-02-01")?.status).toBe("UPCOMING");
    expect(retentionPosition(ledger, invoice.id, "2025-02-28")?.status).toBe("TO_CLAIM");
    expect(forecastConfirmedReceipts(ledger, "2025-01-10")).toContainEqual({
      invoiceId: invoice.id,
      type: "RETENTION",
      dueOn: "2025-02-28",
      amountTtcCents: 6_000,
    });
    expect(() =>
      setChantierLastInvoiceDate(ledger, chantierId, "2024-02-19", "Nadia"),
    ).toThrow("BILLING_FINANCIAL_CLOSING_DATE_BEFORE_INVOICE");
  });

  it("distingue retenue réclamée, encaissée et abandonnée avec justification", () => {
    const draft = approvedDraft();
    const invoice = issuedInvoice(draft);
    const base = setChantierLastInvoiceDate(
      registerConfirmedInvoice(emptyBillingFinancialLedger(), invoice, draft),
      chantierId,
      "2026-12-20",
      "Lucien",
    );
    expect(() =>
      recordRetentionClaim(base, {
        id: crypto.randomUUID(),
        invoiceId: invoice.id,
        claimedOn: "2027-01-01",
        note: "",
        claimedByName: "Nadia",
      }),
    ).toThrow("BILLING_FINANCIAL_RETENTION_NOT_CLAIMABLE");
    const claimed = recordRetentionClaim(base, {
      id: crypto.randomUUID(),
      invoiceId: invoice.id,
      claimedOn: "2027-12-20",
      note: "Relance du client",
      claimedByName: "Nadia",
    });
    expect(retentionPosition(claimed, invoice.id, "2027-12-21")?.status).toBe("CLAIMED");
    const payment = reconcileConfirmedBankPayment(claimed, {
      id: crypto.randomUUID(),
      invoiceId: invoice.id,
      bankMovementId: "garantie-1",
      kind: "RETENTION",
      amountTtcCents: 6_000,
      paidOn: "2027-12-28",
    });
    expect(retentionPosition(payment, invoice.id, "2027-12-29")?.status).toBe("COLLECTED");
    const abandonment = {
      id: crypto.randomUUID(),
      invoiceId: invoice.id,
      abandonedOn: "2027-12-21",
      reason: "Créance irrécouvrable",
      abandonedByName: "Lucien",
    };
    expect(() => abandonRetention(payment, abandonment)).toThrow(
      "BILLING_FINANCIAL_RETENTION_NOT_ABANDONABLE",
    );
    const abandoned = abandonRetention(claimed, abandonment);
    expect(retentionPosition(abandoned, invoice.id, "2027-12-22")?.status).toBe("ABANDONED");
    expect(
      forecastConfirmedReceipts(abandoned, "2027-12-22").some(
        (row) => row.type === "RETENTION",
      ),
    ).toBe(false);
  });
});
