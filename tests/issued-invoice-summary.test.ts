import { describe, expect, it } from "vitest";
import { summarizeIssuedInvoices } from "../src/lib/billing/issued-summary";
import { billingPreparationFollowup } from "../src/lib/billing/preparation-followup";
import type { BillingDraft, BillingSource } from "../src/lib/billing/domain";

const now = new Date("2026-10-31T12:00:00.000Z");
const quoteId = "11111111-1111-4111-8111-111111111111";
const source: BillingSource = {
  quoteId,
  commercialCaseId: "22222222-2222-4222-8222-222222222222",
  chantierId: "33333333-3333-4333-8333-333333333333",
  clientId: "44444444-4444-4444-8444-444444444444",
  clientName: "Client",
  affairName: "Agencement",
  quoteLabel: "D-2026-123",
  contractHtCents: 100_000,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: 100_000 }],
};

const draft = (amountHtCents: number): BillingDraft => ({
  ...source,
  id: crypto.randomUUID(),
  requestId: crypto.randomUUID(),
  status: "APPROVED",
  type: "DEPOSIT",
  label: "Acompte",
  notes: "",
  amountHtCents,
  taxGroups: [{ ratePercent: 20, baseHtCents: amountHtCents, vatCents: amountHtCents / 5 }],
  vatCents: amountHtCents / 5,
  totalTtcCents: amountHtCents * 1.2,
  cumulativePercent: null,
  createdAt: "2026-10-01T08:00:00.000Z",
  createdByName: "Nadia",
  updatedAt: "2026-10-01T08:00:00.000Z",
  updatedByName: "Nadia",
});

describe("factures réellement émises et devis à préparer", () => {
  it("n'invente pas 0€ de CA lorsque Pennylane n'est pas relié", () => {
    expect(summarizeIssuedInvoices([], false, now)).toEqual({
      year: "2026",
      month: "2026-10",
      connected: false,
      yearly: { amountHtCents: null, invoiceCount: null },
      monthly: { amountHtCents: null, invoiceCount: null },
    });
  });

  it("prévoit CA mensuel par date réelle, avoirs en négatif et exclusion des brouillons", () => {
    const issued = summarizeIssuedInvoices([
      { id: "A", issuedAt: "2026-10-01T11:00:00Z", status: "ISSUED", type: "INVOICE", amountHtCents: 120_000 },
      { id: "B", issuedAt: "2026-10-11T11:00:00Z", status: "ISSUED", type: "CREDIT_NOTE", amountHtCents: 20_000 },
      { id: "C", issuedAt: "2026-09-20T11:00:00Z", status: "ISSUED", type: "INVOICE", amountHtCents: 50_000 },
      { id: "D", issuedAt: "2026-10-20T11:00:00Z", status: "DRAFT", type: "INVOICE", amountHtCents: 99_000 },
    ], true, now);
    expect(issued.monthly).toEqual({ amountHtCents: 100_000, invoiceCount: 1 });
    expect(issued.yearly).toEqual({ amountHtCents: 150_000, invoiceCount: 2 });
  });

  it("les projets internes, même approuvés, ne sont jamais comptés comme du facturé", () => {
    expect(billingPreparationFollowup([source], [draft(30_000)]))
      .toEqual([expect.objectContaining({
        status: "PARTIAL", projectCount: 1,
        preparedHtCents: 30_000, remainingToPrepareHtCents: 70_000,
      })]);
    expect(summarizeIssuedInvoices([], false, now).monthly.amountHtCents).toBeNull();
    expect(billingPreparationFollowup([source], [draft(60_000), draft(40_000)])[0]).toMatchObject({
      status: "FULL", remainingToPrepareHtCents: 0,
    });
    expect(billingPreparationFollowup([source], [])[0]).toMatchObject({
      status: "NONE", preparedHtCents: 0, remainingToPrepareHtCents: 100_000,
    });
    expect(() => billingPreparationFollowup([source], [draft(70_000), draft(40_000)]))
      .toThrow("BILLING_PREPARATION_EXCEEDS_CONTRACT");
  });

  it("bascule la date de facturation au mois local Europe/Paris", () => {
    const issued = summarizeIssuedInvoices([
      { id: "Paris", issuedAt: "2026-09-30T22:30:00Z", status: "ISSUED", type: "INVOICE", amountHtCents: 100 },
    ], true, now);
    expect(issued.monthly.amountHtCents).toBe(100);
  });
});
