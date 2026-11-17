import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("retours Achats : recherche de chantiers et affectation fournisseur FG", () => {
  it("remplace les dizaines de cases chantiers par la multi-sélection filtrée des Heures", () => {
    const picker = source("src/components/purchase-destination-multi-picker.tsx");
    const creation = source("src/components/purchase-orders-workspace.tsx");
    const edition = source("src/components/purchase-order-edit-workspace.tsx");
    expect(picker).toContain("multiple");
    expect(picker).toContain("selectedOptions");
    expect(picker).toContain("selectedIds.filter");
    expect(picker).toContain("Ctrl ou Maj");
    expect(creation).toContain("<PurchaseDestinationMultiPicker");
    expect(edition).toContain("<PurchaseDestinationMultiPicker");
    expect(creation).not.toContain("aria-label={`Ajouter ${item.label}`}");
    expect(edition).not.toContain("aria-label={`Ajouter ${item.name}`}");
  });

  it("met le fournisseur sélectionné en gros caractères gras", () => {
    const picker = source("src/components/pennylane-supplier-picker.tsx");
    expect(picker).toContain("Fournisseur sélectionné :");
    expect(picker).toContain("<strong style={{ fontWeight: 800 }}>");
    expect(picker).toContain("fontWeight: 800");
    expect(picker).toContain('role="status"');
  });

  it("propose un seul clic pour actualiser et pré-affecter les factures FG sans validation", () => {
    const creation = source("src/components/purchase-orders-workspace.tsx");
    const route = source("src/app/api/desktop/purchase-invoices/route.ts");
    const store = source("src/lib/pennylane/purchase-invoice-store.ts");
    expect(creation).toContain("Affecter les factures des fournisseurs FG");
    expect(creation).toContain("AUTO_ASSIGN_FG");
    expect(creation).toContain("window.confirm(");
    expect(route).toContain('requireModuleRequestContext("purchases", "WRITE")');
    expect(route).toContain("sameOrigin(request)");
    expect(route).toContain("await synchronizePennylane()");
    expect(route).toContain("autoAllocateImportedGeneralExpensesInvoices");
    expect(store).toContain("ON CONFLICT (invoice_id) DO NOTHING");
    expect(store).toContain("pg_advisory_xact_lock");
    expect(store).toContain("approved, history, updated_at) SELECT x.invoice_id, 1, x.draft, NULL");
    expect(
      store.slice(
        store.indexOf("export async function autoAllocateImportedGeneralExpensesInvoices"),
      ),
    ).not.toContain("LIMIT 501");
  });
});
