import { describe, expect, it } from "vitest";
import {
  assertInvoiceComplete,
  calculateInvoiceAllocation,
  euroToCents,
  invoiceWorkflowState,
  sourceRevision,
  type InvoiceAllocationDraft,
  type InvoiceSource,
  type InvoiceAllocationState,
} from "../src/lib/pennylane/purchase-allocations";

const siteBourg = { kind: "CHANTIER" as const, chantierId: "11111111-1111-4111-8111-111111111111" };
const siteRillieux = { kind: "CHANTIER" as const, chantierId: "22222222-2222-4222-8222-222222222222" };

function draft(): InvoiceAllocationDraft {
  return {
    mode: "GLOBAL",
    rows: [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sourceLineId: null, destination: siteBourg, amountHtCents: 100000 },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", sourceLineId: null, destination: siteRillieux, amountHtCents: 50000 },
    ],
    charges: [],
    orderLinks: [],
    note: "",
  };
}

describe("Ventilation des factures fournisseurs", () => {
  it("répartit la livraison et l'emballage au prorata, sans perte d'un centime", () => {
    const value = draft();
    value.charges = [
      { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", label: "Livraison", amountHtCents: 9000, destinationKeys: [] },
      { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", label: "Emballage", amountHtCents: 3000, destinationKeys: [] },
    ];
    const result = assertInvoiceComplete(value, 162000);
    expect(result.destinations.map(item => item.totalHtCents)).toEqual([108000, 54000]);
    expect(result.destinations.map(item => item.chargesHtCents)).toEqual([8000, 4000]);
  });

  it("répartit une remise globale négative et accepte une correction sur un seul chantier", () => {
    const value = draft();
    value.charges = [{
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", label: "Remise", amountHtCents: -15001,
      destinationKeys: [],
    }];
    let result = calculateInvoiceAllocation(value);
    expect(result.totalHtCents).toBe(134999);
    expect(result.destinations.reduce((sum, item) => sum + item.chargesHtCents, 0)).toBe(-15001);
    value.charges[0].destinationKeys = ["CHANTIER:" + siteRillieux.chantierId];
    result = calculateInvoiceAllocation(value);
    expect(result.destinations[0].chargesHtCents).toBe(0);
    expect(result.destinations[1].chargesHtCents).toBe(-15001);
  });

  it("refuse un total incomplet, y compris les frais sans aucune destination", () => {
    expect(() => assertInvoiceComplete(draft(), 162000)).toThrow("INVOICE_ALLOCATION_INCOMPLETE");
    const value = draft();
    value.rows = [];
    value.charges = [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", label: "Livraison", amountHtCents: 100, destinationKeys: [] }];
    expect(() => calculateInvoiceAllocation(value)).toThrow("INVOICE_CHARGE_NO_DESTINATION");
  });

  it("ne confond pas un changement de statut comptable avec un changement de prix", () => {
    const rev = sourceRevision({ invoiceNumber: "F001", supplierId: "7", amountHtCents: 30000, invoiceDate: "2026-11-16", filename: "facture.pdf" });
    const source: InvoiceSource = {
      id: "42", supplierId: "7", supplierName: "Foussier", invoiceNumber: "F001", invoiceDate: "2026-11-16",
      amountHtCents: 30000, accountingStatus: "validation_needed", hasPdf: true, sourceRevision: rev,
    };
    const allocation = draft();
    const state: InvoiceAllocationState = {
      invoiceId: "42", version: 1, draft: allocation, updatedAt: "2026-11-16T12:00:00Z", history: [],
      approved: {
        draft: allocation, amountHtCents: 30000, validatedAt: "2026-11-16T12:00:00Z",
        validatedBy: "Nadia", sourceRevision: rev,
      },
    };
    expect(invoiceWorkflowState(source, state)).toBe("AWAITING_PENNYLANE");
    expect(invoiceWorkflowState({ ...source, accountingStatus: "complete" }, state)).toBe("VALIDATED");
    expect(invoiceWorkflowState({ ...source, amountHtCents: 31000, sourceRevision: rev + "new" }, state)).toBe("REVALIDATION");
    expect(invoiceWorkflowState(source, { ...state, draft: { ...allocation, note: "Corrigé" } })).toBe("REVALIDATION");
  });

  it("convertit les montants décimaux Pennylane en centimes sans flottants", () => {
    expect(euroToCents("16.0")).toBe(1600);
    expect(euroToCents("0.01")).toBe(1);
    expect(euroToCents("-100.25")).toBe(-10025);
    expect(euroToCents("1,25")).toBe(125);
    expect(euroToCents("12.345")).toBeNull();
    expect(euroToCents("NaN")).toBeNull();
  });
});
