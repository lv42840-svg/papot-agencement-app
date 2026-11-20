import { describe, expect, it } from "vitest";
import {
  approveBillingDraft,
  createBillingDraft,
  type BillingPayload,
  type BillingSource,
} from "../src/lib/billing/domain";
import {
  issueNativeInvoice,
  type NativeIssuedInvoice,
} from "../src/lib/billing/native-issuance";
import {
  assertNativeCreditNoteSequence,
  issueNativeCreditNote,
  nativeCreditAllowances,
  nativeInvoiceNetPosition,
  type NativeCreditNote,
  type IssueNativeCreditNoteInput,
} from "../src/lib/billing/native-credit-notes";
import { generateNativeCreditNotePdf } from "../src/lib/billing/native-credit-pdf";
import { createEmptyCompanyProfile } from "../src/lib/company-profile/domain";
import type { ClientRecord } from "../src/lib/clients/domain";

const source: BillingSource = {
  quoteId: "11111111-1111-4111-8111-111111111111",
  commercialCaseId: "22222222-2222-4222-8222-222222222222",
  chantierId: "33333333-3333-4333-8333-333333333333",
  clientId: "44444444-4444-4444-8444-444444444444",
  clientName: "Client agencement",
  affairName: "Boutique test",
  quoteLabel: "DEV-2026-0042",
  contractHtCents: 100_000,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: 100_000 }],
};
const company = {
  ...createEmptyCompanyProfile(),
  name: "PAPOT AGENCEMENT",
  legalForm: "SARL",
  addressLine1: "7 rue des tests",
  postalCode: "42190",
  city: "Charlieu",
  siret: "12345678901234",
  rcs: "Roanne 123456789",
  vatNumber: "FR00123456789",
};
const client: ClientRecord = {
  id: source.clientId,
  type: "ENTREPRISE",
  companyName: "TEST CLIENT SAS",
  firstName: "",
  lastName: "",
  addressLine1: "2 rue du client",
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
function issued(): { payload: BillingPayload; invoice: NativeIssuedInvoice } {
  const empty: BillingPayload = { schemaVersion: 1, drafts: [] };
  const draft = createBillingDraft(
    empty, source,
    { requestId: crypto.randomUUID(), type: "STANDARD" },
    "Nadia", new Date("2026-11-19T09:00:00.000Z"),
  );
  const approved = approveBillingDraft(
    { ...empty, drafts: [draft] },
    draft.id, draft.updatedAt, "Lucien", new Date("2026-11-19T10:00:00.000Z"),
  );
  const payload = issueNativeInvoice(
    { ...empty, drafts: [approved] },
    {
      requestId: crypto.randomUUID(),
      draftId: approved.id,
      expectedUpdatedAt: approved.updatedAt,
      serviceOn: "2026-11-19",
      dueOn: "2026-12-20",
      operationCategory: "SERVICE",
      vatOnDebits: false,
      buyerPurchaseOrderNumber: "",
      latePenaltyRatePercent: 12,
    },
    company, client, "Lucien", new Date("2026-11-20T09:00:00.000Z"),
  );
  return { payload, invoice: payload.nativeInvoiceLedger!.invoices[0] };
}
function request(
  invoiceId: string,
  htCents: number,
  mode: "PARTIAL" | "FULL" = "PARTIAL",
): IssueNativeCreditNoteInput {
  return {
    requestId: crypto.randomUUID(),
    originalInvoiceId: invoiceId,
    mode,
    reason: "Correction de prestation",
    amounts: [{ ratePercent: 20, baseHtCents: htCents }],
  };
}
function notes(payload: BillingPayload): NativeCreditNote[] {
  return payload.nativeCreditNoteLedger?.creditNotes ?? [];
}

describe("avoirs PAPOT officiels à numérotation indépendante", () => {
  it("émet un avoir partiel sur une facture native sans jamais modifier l'original", () => {
    const { payload, invoice } = issued();
    const result = issueNativeCreditNote(
      payload, request(invoice.id, 20_000), "Nadia", new Date("2026-11-20T11:00:00.000Z"),
    );
    expect(notes(result)).toHaveLength(1);
    const credit = notes(result)[0];
    expect(credit.number).toBe("AV-2026-000001");
    expect(credit.originalInvoiceId).toBe(invoice.id);
    expect(credit.originalInvoiceNumber).toBe(invoice.number);
    expect(credit.originalInvoiceIssuedOn).toBe(invoice.issuedOn);
    expect(credit.amountHtCents).toBe(20_000);
    expect(credit.vatCents).toBe(4_000);
    expect(credit.totalTtcCents).toBe(24_000);
    expect(payload.nativeCreditNoteLedger).toBeUndefined();
    expect(result.nativeInvoiceLedger?.invoices[0]).toEqual(invoice);
    expect(nativeInvoiceNetPosition(result, invoice.id)).toMatchObject({
      originalTtcCents: 120_000,
      creditedTtcCents: 24_000,
      remainingTtcCents: 96_000,
    });
    const pdf = Buffer.from(generateNativeCreditNotePdf(credit, invoice)).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("AVOIR N");
    expect(pdf).toContain("AV-2026-000001");
    expect(pdf).toContain(invoice.number);
    expect(pdf).toContain("Correction de prestation");
    expect(pdf).toContain("TOTAL TTC DE L'AVOIR");
    expect(pdf).toContain("-240,00 EUR");
    expect(pdf).toContain("%%EOF");
  });

  it("un avoir du solde restant consomme les bons montants de TVA", () => {
    const { payload, invoice } = issued();
    const first = issueNativeCreditNote(
      payload, request(invoice.id, 25_000), "Nadia", new Date("2026-11-20T10:00:00.000Z"),
    );
    const second = issueNativeCreditNote(
      first, request(invoice.id, 75_000, "FULL"), "Lucien",
      new Date("2026-11-20T11:00:00.000Z"),
    );
    expect(notes(second).map((item) => item.number)).toEqual([
      "AV-2026-000001", "AV-2026-000002",
    ]);
    expect(notes(second)[1].amountHtCents).toBe(75_000);
    expect(notes(second)[1].vatCents).toBe(15_000);
    expect(nativeInvoiceNetPosition(second, invoice.id).remainingTtcCents).toBe(0);
    expect(() => issueNativeCreditNote(
      second, request(invoice.id, 100), "Nadia",
      new Date("2026-11-20T12:00:00.000Z"),
    )).toThrow("BILLING_NATIVE_CREDIT_EXCEEDS_ORIGINAL");
  });

  it("refuse une correction de TVA excessive, les taux inconnus et les doublons", () => {
    const { payload, invoice } = issued();
    for (const input of [
      request(invoice.id, 100_001),
      { ...request(invoice.id, 1000), amounts: [{ ratePercent: 10, baseHtCents: 1_000 }] },
      {
        ...request(invoice.id, 1000),
        amounts: [
          { ratePercent: 20, baseHtCents: 1000 },
          { ratePercent: 20, baseHtCents: 1000 },
        ],
      },
    ]) {
      expect(() => issueNativeCreditNote(
        payload, input, "Nadia", new Date("2026-11-20T10:00:00.000Z"),
      )).toThrow();
    }
    expect(() => issueNativeCreditNote(
      payload, request(invoice.id, 10_000, "FULL"), "Nadia",
      new Date("2026-11-20T10:00:00.000Z"),
    )).toThrow("BILLING_NATIVE_CREDIT_FULL_AMOUNT_REQUIRED");
  });

  it("refuse de créer un avoir sans facture PAPOT officielle et sans motif", () => {
    const { payload, invoice } = issued();
    expect(() => issueNativeCreditNote(
      payload,
      { ...request(crypto.randomUUID(), 1000) },
      "Lucien",
    )).toThrow("BILLING_NATIVE_CREDIT_ORIGINAL_NOT_FOUND");
    expect(() => issueNativeCreditNote(
      payload,
      { ...request(invoice.id, 1000), reason: "" },
      "Lucien",
    )).toThrow();
  });

  it("un double clic ne consomme aucun second numéro, une demande différente est rejetée", () => {
    const { payload, invoice } = issued();
    const input = request(invoice.id, 30_000);
    const first = issueNativeCreditNote(
      payload, input, "Lucien", new Date("2026-11-20T11:00:00.000Z"),
    );
    const replay = issueNativeCreditNote(
      first, input, "Lucien", new Date("2026-11-20T12:00:00.000Z"),
    );
    expect(replay).toBe(first);
    expect(notes(replay)).toHaveLength(1);
    expect(() => issueNativeCreditNote(
      first, { ...input, reason: "Autre motif" }, "Lucien",
    )).toThrow("BILLING_NATIVE_CREDIT_REQUEST_REUSED");
  });

  it("la série AV reste continue entre 2026 et 2027 et bloque les trous", () => {
    const { payload, invoice } = issued();
    const first = issueNativeCreditNote(
      payload, request(invoice.id, 10_000), "Nadia",
      new Date("2026-12-31T10:00:00.000Z"),
    );
    const second = issueNativeCreditNote(
      first, request(invoice.id, 10_000), "Nadia",
      new Date("2027-01-01T10:00:00.000Z"),
    );
    expect(notes(second).map((item) => item.number)).toEqual([
      "AV-2026-000001", "AV-2027-000002",
    ]);
    expect(() => assertNativeCreditNoteSequence(second.nativeCreditNoteLedger!)).not.toThrow();
    expect(() => assertNativeCreditNoteSequence({
      ...second.nativeCreditNoteLedger!, lastOrdinal: 3,
    })).toThrow("BILLING_NATIVE_CREDIT_SEQUENCE_CORRUPT");
    expect(() => issueNativeCreditNote(
      { ...second, nativeCreditNoteLedger: { ...second.nativeCreditNoteLedger!, lastOrdinal: 3 } },
      request(invoice.id, 10_000), "Nadia", new Date("2027-01-02T10:00:00.000Z"),
    )).toThrow("BILLING_NATIVE_CREDIT_SEQUENCE_CORRUPT");
  });

  it("les crédits archivés restent cohérents avec la facture source", () => {
    const { payload, invoice } = issued();
    const credit = issueNativeCreditNote(
      payload, request(invoice.id, 1000), "Nadia", new Date("2026-11-20T11:00:00.000Z"),
    );
    expect(() => nativeCreditAllowances(invoice, notes(credit))).not.toThrow();
    expect(() => generateNativeCreditNotePdf(notes(credit)[0], {
      ...invoice, number: "PA-2026-999999",
    })).toThrow("BILLING_NATIVE_CREDIT_SOURCE_CORRUPT");
  });
});
