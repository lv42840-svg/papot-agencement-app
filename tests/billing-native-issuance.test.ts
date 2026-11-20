import { describe, expect, it } from "vitest";
import {
  approveBillingDraft,
  createBillingDraft,
  type BillingPayload,
  type BillingSource,
} from "../src/lib/billing/domain";
import {
  assertNativeInvoiceSequence,
  emptyNativeInvoiceLedger,
  issueNativeInvoice,
  type IssueNativeInvoiceInput,
} from "../src/lib/billing/native-issuance";
import { generateNativeInvoicePdf } from "../src/lib/billing/native-invoice-pdf";
import { createEmptyCompanyProfile } from "../src/lib/company-profile/domain";
import type { ClientRecord } from "../src/lib/clients/domain";

const source: BillingSource = {
  quoteId: "11111111-1111-4111-8111-111111111111",
  commercialCaseId: "22222222-2222-4222-8222-222222222222",
  chantierId: "33333333-3333-4333-8333-333333333333",
  clientId: "44444444-4444-4444-8444-444444444444",
  clientName: "Menuiseries client",
  affairName: "Agencement boutique",
  quoteLabel: "DE-2026-48",
  contractHtCents: 100_000,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: 100_000 }],
};
const company = {
  ...createEmptyCompanyProfile(),
  name: "PAPOT AGENCEMENT",
  legalForm: "SARL",
  addressLine1: "7 rue des Testeurs",
  postalCode: "42190",
  city: "Charlieu",
  siret: "12345678901234",
  rcs: "Roanne 123456789",
  vatNumber: "FR00123456789",
  capital: "10 000 EUR",
  iban: "FR7612345678901234567890123",
  bic: "ABCDEFGH",
};
const client = {
  id: source.clientId,
  pennylaneId: undefined,
  type: "ENTREPRISE" as const,
  companyName: "Client test SAS",
  firstName: "",
  lastName: "",
  addressLine1: "1 rue du Projet",
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
  createdAt: "2026-11-20T07:00:00Z",
  createdByName: "Nadia",
  updatedAt: "2026-11-20T07:00:00Z",
  updatedByName: "Nadia",
} satisfies ClientRecord;
const empty = (): BillingPayload => ({ schemaVersion: 1, drafts: [] });
const makeDraft = (src = source) => {
  const draft = createBillingDraft(
    empty(),
    src,
    { requestId: crypto.randomUUID(), type: "STANDARD" },
    "Nadia",
    new Date("2026-11-19T09:00:00Z"),
  );
  return approveBillingDraft(
    { ...empty(), drafts: [draft] },
    draft.id,
    draft.updatedAt,
    "Nadia",
    new Date("2026-11-19T10:00:00Z"),
  );
};
const prepare = (draftId: string, expectedUpdatedAt: string): IssueNativeInvoiceInput => ({
  requestId: crypto.randomUUID(),
  draftId,
  expectedUpdatedAt,
  serviceOn: "2026-11-19",
  dueOn: "2026-12-20",
  operationCategory: "SERVICE",
  vatOnDebits: false,
  buyerPurchaseOrderNumber: "BC-008",
  latePenaltyRatePercent: 12,
});

describe("numérotation légale PAPOT sans liaison d'émission Pennylane", () => {
  it("numérote l'émission après validation, fige les identités et fournit un PDF", () => {
    const draft = makeDraft();
    const original = { ...empty(), drafts: [draft] };
    const input = prepare(draft.id, draft.updatedAt);
    const issued = issueNativeInvoice(
      original,
      input,
      company,
      client,
      "Lucien",
      new Date("2026-11-20T10:00:00Z"),
    );
    expect(issued.nativeInvoiceLedger?.lastOrdinal).toBe(1);
    const record = issued.nativeInvoiceLedger!.invoices[0];
    expect(record.number).toBe("PA-2026-000001");
    expect(record.status).toBe("ISSUED");
    expect(record.buyer.name).toBe("Client test SAS");
    expect(record.totalTtcCents).toBe(120_000);
    expect(original.nativeInvoiceLedger).toBeUndefined();
    const pdf = Buffer.from(generateNativeInvoicePdf(record)).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("PA-2026-000001");
    expect(pdf).toContain("TOTAL TTC");
    expect(pdf).toContain("Client test SAS");
    expect(pdf).toContain("1200,00 EUR");
    expect(pdf).not.toContain("PROVISOIRE - NON FACTURE");
  });

  it("numérote aussi un devis retenu sans chantier sans utiliser une autre série", () => {
    const quoteOnly = makeDraft({
      ...source,
      chantierId: null,
      quoteId: "77777777-7777-4777-8777-777777777777",
    });
    const generated = issueNativeInvoice(
      { ...empty(), drafts: [quoteOnly] },
      prepare(quoteOnly.id, quoteOnly.updatedAt),
      company,
      client,
      "Lucien",
      new Date("2026-11-20T11:00:00Z"),
    );
    const record = generated.nativeInvoiceLedger!.invoices[0];
    expect(record.chantierId).toBeNull();
    expect(record.sourceQuoteId).toBe("77777777-7777-4777-8777-777777777777");
    expect(record.number).toBe("PA-2026-000001");
  });

  it("le même identifiant de demande n'attribue pas un second numéro", () => {
    const draft = makeDraft();
    const input = prepare(draft.id, draft.updatedAt);
    const one = issueNativeInvoice(
      { ...empty(), drafts: [draft] },
      input,
      company,
      client,
      "Nadia",
      new Date("2026-11-20T10:00:00Z"),
    );
    const replay = issueNativeInvoice(
      one,
      input,
      company,
      client,
      "Nadia",
      new Date("2026-11-20T10:00:05Z"),
    );
    expect(replay).toBe(one);
    expect(replay.nativeInvoiceLedger?.invoices).toHaveLength(1);
    expect(() =>
      issueNativeInvoice(
        one,
        { ...input, requestId: crypto.randomUUID() },
        company,
        client,
        "Lucien",
        new Date("2026-11-20T10:00:10Z"),
      ),
    ).toThrow("BILLING_NATIVE_ALREADY_ISSUED");
  });

  it("conserve une suite croissante entre deux années, sans réinitialisation", () => {
    const a = makeDraft();
    const b = makeDraft({
      ...source,
      quoteId: "55555555-5555-4555-8555-555555555555",
      chantierId: "66666666-6666-4666-8666-666666666666",
    });
    const p = { ...empty(), drafts: [a, b] };
    const first = issueNativeInvoice(
      p,
      { ...prepare(a.id, a.updatedAt), dueOn: "2027-01-30" },
      company,
      client,
      "Nadia",
      new Date("2026-12-31T12:00:00Z"),
    );
    const second = issueNativeInvoice(
      first,
      { ...prepare(b.id, b.updatedAt), serviceOn: "2026-12-31", dueOn: "2027-02-01" },
      company,
      client,
      "Nadia",
      new Date("2027-01-01T12:00:00Z"),
    );
    expect(second.nativeInvoiceLedger?.invoices.map((item) => item.number)).toEqual([
      "PA-2026-000001",
      "PA-2027-000002",
    ]);
    expect(second.nativeInvoiceLedger?.lastOrdinal).toBe(2);
  });

  it("bloque brouillon non approuvé, identité vendeur incomplète et antédate", () => {
    const approved = makeDraft();
    const input = prepare(approved.id, approved.updatedAt);
    expect(() =>
      issueNativeInvoice(
        { ...empty(), drafts: [{ ...approved, status: "DRAFT" }] },
        input,
        company,
        client,
        "Lucien",
        new Date("2026-11-20T10:00:00Z"),
      ),
    ).toThrow("BILLING_NATIVE_APPROVAL_REQUIRED");
    expect(() =>
      issueNativeInvoice(
        { ...empty(), drafts: [approved] },
        input,
        { ...company, siret: "" },
        client,
        "Lucien",
        new Date("2026-11-20T10:00:00Z"),
      ),
    ).toThrow("BILLING_NATIVE_SELLER_PROFILE_INCOMPLETE");
    expect(() =>
      issueNativeInvoice(
        { ...empty(), drafts: [approved] },
        { ...input, serviceOn: "2026-11-25" },
        company,
        client,
        "Lucien",
        new Date("2026-11-20T10:00:00Z"),
      ),
    ).toThrow("BILLING_NATIVE_DATES_INVALID");
  });

  it("refuse les trous de numérotation et les doubles références avant une nouvelle émission", () => {
    const draft = makeDraft();
    const saved = issueNativeInvoice(
      { ...empty(), drafts: [draft] },
      prepare(draft.id, draft.updatedAt),
      company,
      client,
      "Lucien",
      new Date("2026-11-20T10:00:00Z"),
    );
    const state = saved.nativeInvoiceLedger!;
    expect(() => assertNativeInvoiceSequence(state)).not.toThrow();
    for (const corrupt of [
      { ...state, lastOrdinal: 10 },
      { ...state, invoices: [{ ...state.invoices[0], number: "PA-2026-000003" }] },
      { ...state, invoices: [state.invoices[0], state.invoices[0]], lastOrdinal: 2 },
    ]) {
      expect(() => assertNativeInvoiceSequence(corrupt)).toThrow("BILLING_NATIVE_SEQUENCE_CORRUPT");
      expect(() =>
        issueNativeInvoice(
          { ...saved, nativeInvoiceLedger: corrupt },
          prepare(draft.id, draft.updatedAt),
          company,
          client,
          "Lucien",
          new Date("2026-11-20T11:00:00Z"),
        ),
      ).toThrow("BILLING_NATIVE_SEQUENCE_CORRUPT");
    }
  });

  it("garde les compteurs vides avant la première émission", () => {
    expect(emptyNativeInvoiceLedger()).toEqual({ lastOrdinal: 0, invoices: [] });
  });
});
