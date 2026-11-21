import { describe, expect, it } from "vitest";
import {
  approveBillingDraft,
  createBillingDraft,
  type BillingPayload,
  type BillingSource,
} from "../src/lib/billing/domain";
import { issueNativeInvoice, type IssueNativeInvoiceInput } from "../src/lib/billing/native-issuance";
import {
  emptyBillingTestSandbox,
  findBillingTestDocument,
  resetBillingTestSandbox,
  simulateBillingTestCredit,
  simulateBillingTestInvoice,
  summarizeBillingTestSandbox,
  TEST_RESET_CONFIRMATION,
} from "../src/lib/billing/test-sandbox";
import { generateNativeInvoicePdf } from "../src/lib/billing/native-invoice-pdf";
import { generateNativeCreditNotePdf } from "../src/lib/billing/native-credit-pdf";
import { createEmptyCompanyProfile } from "../src/lib/company-profile/domain";
import type { ClientRecord } from "../src/lib/clients/domain";

const source: BillingSource = {
  quoteId: "11111111-1111-4111-8111-111111111111",
  commercialCaseId: "22222222-2222-4222-8222-222222222222",
  chantierId: "33333333-3333-4333-8333-333333333333",
  clientId: "44444444-4444-4444-8444-444444444444",
  clientName: "Client essai",
  affairName: "Boutique essai",
  quoteLabel: "D-TEST",
  contractHtCents: 100_000,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: 100_000 }],
};
const profile = {
  ...createEmptyCompanyProfile(),
  name: "PAPOT AGENCEMENT",
  legalForm: "SARL",
  addressLine1: "1 avenue de Test",
  postalCode: "42190",
  city: "Charlieu",
  siret: "12345678901234",
  rcs: "Roanne 123456789",
  vatNumber: "FR00123456789",
};
const client: ClientRecord = {
  id: source.clientId,
  type: "ENTREPRISE",
  companyName: "Client test SAS",
  firstName: "",
  lastName: "",
  addressLine1: "1 route des Tests",
  addressLine2: "",
  postalCode: "69000",
  city: "Lyon",
  phone: "",
  email: "",
  siret: "12345678901234",
  vatNumber: "FR00123456789",
  paymentTerms: "30 jours",
  defaultVatRatePercent: 20,
  notes: "",
  contacts: [],
  isArchived: false,
  archivedAt: null,
  createdAt: "2026-11-19T09:00:00.000Z",
  createdByName: "Nadia",
  updatedAt: "2026-11-19T09:00:00.000Z",
  updatedByName: "Nadia",
};
const now = new Date("2026-11-20T11:00:00.000Z");

function approved(): BillingPayload {
  const empty: BillingPayload = { schemaVersion: 1, drafts: [] };
  const draft = createBillingDraft(
    empty, source,
    { requestId: crypto.randomUUID(), type: "STANDARD" },
    "Nadia", new Date("2026-11-19T09:00:00.000Z"),
  );
  return {
    ...empty,
    drafts: [approveBillingDraft(
      { ...empty, drafts: [draft] },
      draft.id, draft.updatedAt, "Nadia",
      new Date("2026-11-19T10:00:00.000Z"),
    )],
  };
}
function input(payload: BillingPayload): IssueNativeInvoiceInput {
  return {
    requestId: crypto.randomUUID(),
    draftId: payload.drafts[0].id,
    expectedUpdatedAt: payload.drafts[0].updatedAt,
    serviceOn: "2026-11-19",
    dueOn: "2026-12-20",
    operationCategory: "SERVICE",
    vatOnDebits: false,
    buyerPurchaseOrderNumber: "",
    latePenaltyRatePercent: 12,
  };
}

describe("facturation fictive et remise à zéro strictement isolées", () => {
  it("ne consomme pas la série officielle quand un essai utilise le même projet", () => {
    const original = approved();
    const legal = issueNativeInvoice(original, input(original), profile, client, "Lucien", now);
    const simulated = simulateBillingTestInvoice(
      legal, input(legal), profile, client, "Nadia", now,
    );
    expect(simulated.nativeInvoiceLedger).toEqual(legal.nativeInvoiceLedger);
    expect(simulated.drafts).toEqual(legal.drafts);
    expect(simulated.nativeCreditNoteLedger).toEqual(legal.nativeCreditNoteLedger);
    expect(legal.testSandbox).toBeUndefined();
    const summary = summarizeBillingTestSandbox(simulated);
    expect(summary.invoices).toHaveLength(1);
    expect(summary.invoices[0].number).toBe("TEST-PA-2026-000001");
    expect(simulated.testSandbox?.invoiceLedger.lastOrdinal).toBe(1);
    expect(legal.nativeInvoiceLedger?.lastOrdinal).toBe(1);
  });

  it("les avoirs simulés ne changent aucun solde officiel", () => {
    const original = approved();
    const legal = issueNativeInvoice(original, input(original), profile, client, "Lucien", now);
    const invoiceSandbox = simulateBillingTestInvoice(
      legal, input(legal), profile, client, "Lucien", now,
    );
    const simulatedInvoice = invoiceSandbox.testSandbox!.invoiceLedger.invoices[0];
    const credit = simulateBillingTestCredit(
      invoiceSandbox,
      {
        requestId: crypto.randomUUID(),
        originalInvoiceId: simulatedInvoice.id,
        mode: "PARTIAL",
        reason: "Réduction sur prestation test",
        amounts: [{ ratePercent: 20, baseHtCents: 10_000 }],
      },
      "Nadia", now,
    );
    expect(credit.nativeCreditNoteLedger).toBeUndefined();
    expect(credit.nativeInvoiceLedger).toEqual(legal.nativeInvoiceLedger);
    const result = summarizeBillingTestSandbox(credit);
    expect(result.credits[0].number).toBe("TEST-AV-2026-000001");
    expect(result.credits[0].totalTtcCents).toBe(12_000);
    expect(result.invoices[0].remainingTtcCents).toBe(108_000);
    const invoice = findBillingTestDocument(credit, simulatedInvoice.id);
    expect(invoice.kind).toBe("INVOICE");
    const note = credit.testSandbox!.creditLedger.creditNotes[0];
    const found = findBillingTestDocument(credit, note.id);
    expect(found.kind).toBe("CREDIT");
    if (found.kind === "CREDIT") {
      expect(
        Buffer.from(generateNativeCreditNotePdf(found.credit, found.original, { testOnly: true }))
          .toString("latin1"),
      ).toContain("SPECIMEN - TEST - NON VALABLE");
    }
  });

  it("les PDF tests sont marqués sur chaque page, les PDF officiels restent inchangés", () => {
    const payload = approved();
    const legal = issueNativeInvoice(payload, input(payload), profile, client, "Lucien", now);
    const original = legal.nativeInvoiceLedger!.invoices[0];
    const official = Buffer.from(generateNativeInvoicePdf(original)).toString("latin1");
    const simulated = Buffer.from(generateNativeInvoicePdf(original, { testOnly: true }))
      .toString("latin1");
    expect(official).not.toContain("SANS VALEUR FISCALE");
    expect(official).not.toContain("SPECIMEN - TEST - NON VALABLE");
    expect(simulated).toContain("SANS VALEUR FISCALE");
    expect(simulated).toContain("SPECIMEN - TEST - NON VALABLE");
  });

  it("la purge retire uniquement les essais, réinitialise leurs compteurs et garde un audit", () => {
    const seed = approved();
    const legal = issueNativeInvoice(seed, input(seed), profile, client, "Lucien", now);
    const tests = simulateBillingTestInvoice(
      legal, input(legal), profile, client, "Nadia", now,
    );
    const reset = resetBillingTestSandbox(
      tests, TEST_RESET_CONFIRMATION, "Lucien", new Date("2026-11-20T12:00:00.000Z"),
    );
    expect(reset.nativeInvoiceLedger).toEqual(legal.nativeInvoiceLedger);
    expect(reset.drafts).toEqual(legal.drafts);
    expect(reset.testSandbox).toMatchObject({
      invoiceLedger: { lastOrdinal: 0, invoices: [] },
      creditLedger: { lastOrdinal: 0, creditNotes: [] },
      resetCount: 1,
      lastResetByName: "Lucien",
      lastResetAt: "2026-11-20T12:00:00.000Z",
    });
    expect(() => findBillingTestDocument(
      reset, tests.testSandbox!.invoiceLedger.invoices[0].id,
    )).toThrow("BILLING_TEST_DOCUMENT_NOT_FOUND");
    const second = simulateBillingTestInvoice(
      reset, input(reset), profile, client, "Nadia", new Date("2026-11-21T09:00:00.000Z"),
    );
    expect(summarizeBillingTestSandbox(second).invoices[0].number).toBe(
      "TEST-PA-2026-000001",
    );
    expect(second.nativeInvoiceLedger).toEqual(legal.nativeInvoiceLedger);
    expect(second.testSandbox?.resetCount).toBe(1);
  });

  it("refuse de supprimer les essais sans la phrase exacte", () => {
    const payload = approved();
    expect(() => resetBillingTestSandbox(payload, "", "Nadia")).toThrow(
      "BILLING_TEST_CONFIRMATION_REQUIRED",
    );
    expect(() => resetBillingTestSandbox(payload, "EFFACER LES FACTURES", "Lucien")).toThrow(
      "BILLING_TEST_CONFIRMATION_REQUIRED",
    );
    expect(emptyBillingTestSandbox().invoiceLedger.lastOrdinal).toBe(0);
  });

  it("refuse un avoir test rattaché à une facture officielle plutôt qu'à une simulation", () => {
    const payload = approved();
    const legal = issueNativeInvoice(payload, input(payload), profile, client, "Lucien", now);
    const legalId = legal.nativeInvoiceLedger!.invoices[0].id;
    expect(() => simulateBillingTestCredit(
      legal,
      {
        requestId: crypto.randomUUID(),
        originalInvoiceId: legalId,
        mode: "PARTIAL",
        reason: "Test sur une facture officielle",
        amounts: [{ ratePercent: 20, baseHtCents: 100 }],
      },
      "Nadia", now,
    )).toThrow("BILLING_NATIVE_CREDIT_ORIGINAL_NOT_FOUND");
  });
});
