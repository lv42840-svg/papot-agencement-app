import { describe, it, expect } from "vitest";
import {
  createBillingDraft,
  parseBillingPayload,
  updateBillingDocument,
  type BillingDocumentLine,
  type BillingPayload,
  type BillingSource,
} from "../src/lib/billing/domain";
import {
  buildInvoiceDocumentLines,
  calculateInvoiceDocumentTotals,
} from "../src/lib/billing/document-lines";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const source: BillingSource = {
  quoteId: "11111111-1111-4111-8111-111111111111",
  commercialCaseId: "22222222-2222-4222-8222-222222222222",
  chantierId: "33333333-3333-4333-8333-333333333333",
  clientId: "44444444-4444-4444-8444-444444444444",
  clientName: "Client test",
  affairName: "Affaire test",
  quoteLabel: "D-2026-1201",
  contractHtCents: 3_500_000,
  contractTaxGroups: [
    { ratePercent: 10, baseHtCents: 2_000_000 },
    { ratePercent: 20, baseHtCents: 1_500_000 },
  ],
  lines: [
    {
      lineId: A,
      description: "Menuiserie",
      quantity: 2,
      unit: "u",
      amountHtCents: 2_000_000,
      vatRatePercent: 10,
    },
    {
      lineId: B,
      description: "Serrurerie",
      quantity: 1,
      unit: "forfait",
      amountHtCents: 1_000_000,
      vatRatePercent: 20,
    },
    {
      lineId: C,
      description: "Pose",
      quantity: 1,
      unit: "forfait",
      amountHtCents: 500_000,
      vatRatePercent: 20,
    },
  ],
};
const initial = (): BillingPayload => ({ schemaVersion: 1, drafts: [] });
function make(input: Parameters<typeof createBillingDraft>[2], payload = initial()) {
  return createBillingDraft(payload, source, input, "Nadia");
}
function patch(
  draft: ReturnType<typeof make>,
  rows: BillingDocumentLine[],
  payload: BillingPayload = { schemaVersion: 1, drafts: [draft] },
) {
  return updateBillingDocument(
    payload,
    draft.id,
    {
      expectedUpdatedAt: draft.updatedAt,
      label: "Facture personnalisée",
      notes: "Bon pour contrôle",
      documentLines: rows,
    },
    "Lucien",
    new Date("2026-10-17T16:00:00.000Z"),
  );
}

describe("éditeur de facture autonome", () => {
  it("reprend les lignes du devis sans le modifier et avec les montants exacts", () => {
    const original = JSON.stringify(source);
    const full = make({ requestId: crypto.randomUUID(), type: "STANDARD" });
    expect(full.documentLines).toHaveLength(3);
    expect(full.documentLines?.map((line) => line.sourceLineId)).toEqual([A, B, C]);
    expect(full.documentLines?.map((line) => line.description)).toEqual([
      "Menuiserie",
      "Serrurerie",
      "Pose",
    ]);
    const totals = calculateInvoiceDocumentTotals(full.documentLines!);
    expect(totals.amountHtCents).toBe(3_500_000);
    expect(totals.vatCents).toBe(500_000);
    expect(JSON.stringify(source)).toBe(original);
    expect(
      parseBillingPayload({ schemaVersion: 1, drafts: [full] }).drafts[0].documentLines,
    ).toHaveLength(3);
  });

  it("ajoute une ligne libre et un titre, et recalcule par taux sans dépasser le devis", () => {
    const deposit = make({
      requestId: crypto.randomUUID(),
      type: "DEPOSIT",
      amountHtCents: 350_000,
    });
    const rows = deposit.documentLines!.map((line) => ({ ...line }));
    const first = rows[0];
    rows[0] = {
      ...first,
      description: "Pose et fourniture modifiées",
      quantity: 1,
      unit: "forfait",
      unitPriceCents: Math.round(first.quantity * first.unitPriceCents) - 10_000,
    };
    rows.push({
      id: crypto.randomUUID(),
      origin: "FREE",
      sourceLineId: null,
      description: "Transport complémentaire",
      quantity: 2,
      unit: "h",
      unitPriceCents: 5_000,
      vatRatePercent: first.vatRatePercent,
    });
    rows.push({
      id: crypto.randomUUID(),
      origin: "TITLE",
      sourceLineId: null,
      description: "Travaux annexes",
      quantity: 0,
      unit: "",
      unitPriceCents: 0,
      vatRatePercent: 0,
    });
    const updated = patch(deposit, rows);
    expect(updated.amountHtCents).toBe(350_000);
    expect(updated.totalTtcCents).toBe(deposit.totalTtcCents);
    expect(updated.documentLines).toHaveLength(5);
    expect(updated.documentLines?.[0].description).toBe("Pose et fourniture modifiées");
    expect(updated.updatedByName).toBe("Lucien");
    expect(updated.status).toBe("DRAFT");
    expect(source.lines?.[0].description).toBe("Menuiserie");
  });

  it("refuse de dépasser le contrat en ajoutant des prestations", () => {
    const full = make({ requestId: crypto.randomUUID(), type: "STANDARD" });
    const rows: BillingDocumentLine[] = [
      ...full.documentLines!,
      {
        id: crypto.randomUUID(),
        origin: "FREE",
        sourceLineId: null,
        description: "Plus-value sans devis complémentaire",
        quantity: 1,
        unit: "u",
        unitPriceCents: 100,
        vatRatePercent: 20,
      },
    ];
    expect(() => patch(full, rows)).toThrow("BILLING_AMOUNT_EXCEEDS_CONTRACT");
  });

  it("protège les droits métier : sources invalides, doublons, TVA hors contrat", () => {
    const full = make({ requestId: crypto.randomUUID(), type: "STANDARD" });
    expect(() =>
      patch(full, [
        ...full.documentLines!,
        {
          ...full.documentLines![0],
          id: crypto.randomUUID(),
        },
      ]),
    ).toThrow("BILLING_DOCUMENT_SOURCE_LINE_INVALID");
    expect(() =>
      patch(
        full,
        full.documentLines!.map((row, i) => (i === 0 ? { ...row, vatRatePercent: 5.5 } : row)),
      ),
    ).toThrow("BILLING_DOCUMENT_VAT_OUTSIDE_CONTRACT");
    expect(() =>
      patch(
        full,
        full.documentLines!.map((row, i) => (i === 0 ? { ...row, description: " " } : row)),
      ),
    ).toThrow();
  });

  it("bloque les modifications financières d'un brouillon suivi d'une autre situation", () => {
    const first = make({ requestId: crypto.randomUUID(), type: "PROGRESS", cumulativePercent: 30 });
    const second = make(
      { requestId: crypto.randomUUID(), type: "PROGRESS", cumulativePercent: 60 },
      { schemaVersion: 1, drafts: [first] },
    );
    expect(() =>
      patch(
        first,
        first.documentLines!.map((row, i) =>
          i === 0 ? { ...row, unitPriceCents: row.unitPriceCents + 100 } : row,
        ),
        { schemaVersion: 1, drafts: [first, second] },
      ),
    ).toThrow("BILLING_DRAFT_HAS_DEPENDENTS");
    const unchangedTotals = patch(
      first,
      first.documentLines!.map((row, i) =>
        i === 0 ? { ...row, description: "Désignation corrigée" } : row,
      ),
      { schemaVersion: 1, drafts: [first, second] },
    );
    expect(unchangedTotals.amountHtCents).toBe(first.amountHtCents);
    expect(second.amountHtCents).toBeGreaterThan(0);
  });

  it("détecte l'édition d'une ancienne version", () => {
    const draft = make({ requestId: crypto.randomUUID(), type: "DEPOSIT", amountHtCents: 90_000 });
    expect(() =>
      updateBillingDocument(
        { schemaVersion: 1, drafts: [draft] },
        draft.id,
        {
          expectedUpdatedAt: "2026-10-01T00:00:00.000Z",
          label: "Facture",
          notes: "",
          documentLines: draft.documentLines!,
        },
        "Nadia",
      ),
    ).toThrow("BILLING_VERSION_CONFLICT");
  });

  it("conserve les lignes des situations progressives et les montants après acompte", () => {
    const deposit = make({
      requestId: crypto.randomUUID(),
      type: "DEPOSIT",
      amountHtCents: 350_000,
    });
    const situation = make(
      {
        requestId: crypto.randomUUID(),
        type: "PROGRESS",
        linePercentages: [
          { lineId: A, percent: 80 },
          { lineId: B, percent: 30 },
          { lineId: C, percent: 0 },
        ],
      },
      { schemaVersion: 1, drafts: [deposit] },
    );
    expect(situation.amountHtCents).toBe(1_550_000);
    expect(situation.documentLines?.map((line) => line.sourceLineId)).toEqual([A, B, C]);
    expect(situation.documentLines?.map((line) => line.unitPriceCents)).toEqual([
      1_400_000, 150_000, 0,
    ]);
    // The editor's persisted line snapshot must exactly match the analytic situation.
    const totals = calculateInvoiceDocumentTotals(situation.documentLines!);
    expect(totals.amountHtCents).toBe(situation.amountHtCents);
    expect(totals.taxGroups.map((group) => group.baseHtCents)).toEqual(
      situation.taxGroups.map((group) => group.baseHtCents),
    );
    expect(
      buildInvoiceDocumentLines(situation, { schemaVersion: 1, drafts: [deposit, situation] })
        .length,
    ).toBe(3);
  });
});
