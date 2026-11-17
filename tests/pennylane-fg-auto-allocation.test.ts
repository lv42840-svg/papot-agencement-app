import { describe, expect, it } from "vitest";
import {
  planGeneralExpensesAllocations,
  type InvoiceForGeneralExpenses,
} from "../src/lib/pennylane/general-expenses-auto-allocation";
import type { InvoiceSource } from "../src/lib/pennylane/purchase-allocations";

const source = (id: string, overrides: Partial<InvoiceSource> = {}): InvoiceSource => ({
  id,
  supplierId: "42",
  supplierName: "Fournisseur FG",
  invoiceNumber: "FAC-" + id,
  invoiceDate: "2026-11-17",
  amountHtCents: 19850,
  accountingStatus: "complete",
  hasPdf: true,
  sourceRevision: "revision-" + id,
  ...overrides,
});
const row = (
  id: string,
  overrides: Partial<InvoiceSource> = {},
  alreadyAllocated = false,
): InvoiceForGeneralExpenses => ({ source: source(id, overrides), alreadyAllocated });

describe("pré-affectation en lot des fournisseurs frais généraux", () => {
  it("crée des brouillons FG exacts sans validation PAPOT ni rapprochement BC", () => {
    const result = planGeneralExpensesAllocations(
      [row("101"), row("102", { supplierId: "99" }), row("103", { accountingStatus: "pending" })],
      new Set(["42"]),
      () => "11111111-1111-4111-8111-111111111111",
    );
    expect(result.matchingSupplierInvoices).toBe(2);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].draft.rows).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        sourceLineId: null,
        destination: { kind: "GENERAL_EXPENSES", chantierId: null },
        amountHtCents: 19850,
      },
    ]);
    expect(result.candidates[0].draft.orderLinks).toEqual([]);
    expect(result.candidates[0].draft.charges).toEqual([]);
    expect(result.candidates[0].draft.note).toContain("à contrôler et valider");
  });

  it("n'écrase jamais un brouillon ou une affectation antérieure", () => {
    const result = planGeneralExpensesAllocations([row("101", {}, true)], new Set(["42"]));
    expect(result.candidates).toHaveLength(0);
    expect(result.skippedExisting).toBe(1);
  });

  it("ignore les avoirs, montants nuls, devises sans EUR et fournisseurs inconnus", () => {
    const result = planGeneralExpensesAllocations(
      [
        row("1", { amountHtCents: -100 }),
        row("2", { amountHtCents: 0 }),
        row("3", { amountHtCents: null }),
        row("4", { supplierId: null }),
        row("5", { invoiceNumber: "" }),
      ],
      new Set(["42"]),
    );
    expect(result.candidates).toHaveLength(0);
    expect(result.skippedInvalid).toBe(4);
    expect(result.matchingSupplierInvoices).toBe(4);
  });

  it("écarte tous les doublons de facture pour éviter une double ventilation", () => {
    const result = planGeneralExpensesAllocations(
      [
        row("101", { invoiceNumber: "FC-1", amountHtCents: 10000 }),
        row("102", { invoiceNumber: "FC-1", amountHtCents: 10000 }),
        row("103"),
      ],
      new Set(["42"]),
    );
    expect(result.skippedDuplicate).toBe(2);
    expect(result.candidates.map((item) => item.invoiceId)).toEqual(["103"]);
  });

  it("ignore les préférences vides, même lorsque des factures sont importées", () => {
    const result = planGeneralExpensesAllocations([row("101")], new Set());
    expect(result.matchingSupplierInvoices).toBe(0);
    expect(result.candidates).toHaveLength(0);
  });
});
