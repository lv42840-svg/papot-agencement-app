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

  it("affiche le bouton FG dans Factures fournisseurs seulement", () => {
    const creation = source("src/components/purchase-orders-workspace.tsx");
    const invoices = source("src/components/purchase-invoices-workspace.tsx");
    expect(creation).not.toContain("AUTO_ASSIGN_FG");
    expect(creation).not.toContain("Affecter les factures FG");
    expect(invoices).toContain("Affecter les factures FG");
    expect(invoices).toContain('void mutate("AUTO_ASSIGN_FG")');
    expect(invoices).toContain("fgSupplierCount");
  });

  it("actualise, approuve dans PAPOT et préserve l'indépendance comptable", () => {
    const invoiceRoute = source("src/app/api/desktop/purchase-invoices/route.ts");
    const sync = source("src/lib/pennylane/sync.ts");
    const settingsRoute = source("src/app/api/desktop/pennylane/route.ts");
    const store = source("src/lib/pennylane/purchase-invoice-store.ts");
    expect(invoiceRoute).toContain('requireModuleRequestContext("purchases", "WRITE")');
    expect(invoiceRoute).toContain("sameOrigin(request)");
    expect(invoiceRoute).toContain('action === "AUTO_ASSIGN_FG"');
    expect(invoiceRoute).toContain("refreshed.generalExpenses");
    expect(sync).toContain("autoAllocateImportedGeneralExpensesInvoices(actor)");
    expect(settingsRoute).toContain("synchronizePennylane(context.user.displayName)");
    expect(store).toContain("purchaseOrderAllocations(order)");
    expect(store).toContain("possibleChantierOrder");
    expect(store).toContain("ON CONFLICT (invoice_id) DO NOTHING");
    expect(store).toContain("pg_advisory_xact_lock");
    expect(store).toContain('action: "VALIDATE"');
    expect(store).toContain("validatedBy: actor");
    expect(store).not.toContain("x.draft, NULL, x.history");
    expect(
      store.slice(
        store.indexOf("export async function autoAllocateImportedGeneralExpensesInvoices"),
      ),
    ).not.toContain("LIMIT 501");
  });
});
