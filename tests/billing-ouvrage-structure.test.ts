import { describe, expect, it } from "vitest";
import { calculateInvoiceDocumentTotals } from "../src/lib/billing/document-lines";
import {
  createBillingDraft,
  type BillingDocumentLine,
  type BillingSource,
} from "../src/lib/billing/domain";
import {
  groupInvoiceOuvrages,
  moveInvoiceEditorRow,
} from "../src/lib/billing/ouvrage-structure";

const source: BillingSource = {
  quoteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  commercialCaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  chantierId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  clientId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  clientName: "Client",
  affairName: "Chantier",
  quoteLabel: "D-2026-01",
  contractHtCents: 30_000,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: 30_000 }],
  lines: [
    {
      lineId: "11111111-1111-4111-8111-111111111111",
      description: "Meuble",
      amountHtCents: 20_000,
      vatRatePercent: 20,
    },
    {
      lineId: "22222222-2222-4222-8222-222222222222",
      description: "Pose",
      amountHtCents: 10_000,
      vatRatePercent: 20,
    },
  ],
  structure: [
    { kind: "TITLE", title: "Mobilier" },
    { kind: "LINE", lineId: "11111111-1111-4111-8111-111111111111" },
    { kind: "TITLE", title: "Pose" },
    { kind: "LINE", lineId: "22222222-2222-4222-8222-222222222222" },
  ],
};

describe("ouvrages de la facture", () => {
  it("reprend les titres du devis sans modifier ses montants", () => {
    const draft = createBillingDraft(
      { schemaVersion: 1, drafts: [] },
      source,
      { requestId: crypto.randomUUID(), type: "STANDARD" },
      "Lucien",
    );
    const lines = draft.documentLines ?? [];
    expect(lines.map((line) => line.description)).toEqual([
      "Mobilier",
      "Meuble",
      "Pose",
      "Pose",
    ]);
    expect(lines.filter((line) => line.origin === "TITLE")).toHaveLength(2);
    const groups = groupInvoiceOuvrages(lines);
    expect(groups.map((group) => group.amountHtCents)).toEqual([20_000, 10_000]);
    expect(calculateInvoiceDocumentTotals(lines).amountHtCents).toBe(30_000);
  });

  it("déplace un ouvrage avec toutes ses prestations, sans mélanger les sections", () => {
    const rows = [
      { id: "t1", origin: "TITLE" },
      { id: "a", origin: "QUOTE" },
      { id: "b", origin: "QUOTE" },
      { id: "t2", origin: "TITLE" },
      { id: "c", origin: "FREE" },
    ];
    expect(moveInvoiceEditorRow(rows, 0, 1).map((row) => row.id)).toEqual([
      "t2",
      "c",
      "t1",
      "a",
      "b",
    ]);
    expect(moveInvoiceEditorRow(rows, 3, -1).map((row) => row.id)).toEqual([
      "t2",
      "c",
      "t1",
      "a",
      "b",
    ]);
    expect(moveInvoiceEditorRow(rows, 2, 1)).toBe(rows);
    expect(moveInvoiceEditorRow(rows, 1, -1)).toBe(rows);
  });

  it("classe les lignes libres avant le premier titre à part", () => {
    const lines: BillingDocumentLine[] = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        origin: "FREE",
        sourceLineId: null,
        description: "Forfait",
        quantity: 1,
        unit: "u",
        unitPriceCents: 10_000,
        vatRatePercent: 20,
      },
    ];
    expect(groupInvoiceOuvrages(lines)[0]).toMatchObject({
      title: "Prestations sans titre",
      amountHtCents: 10_000,
      endExclusive: 1,
    });
  });
});
