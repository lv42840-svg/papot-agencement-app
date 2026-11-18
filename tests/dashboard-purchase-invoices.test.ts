import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("accueil : factures fournisseurs à valider", () => {
  it("affiche un compteur cliquable seulement avec le droit Achats", () => {
    const home = source("src/app/desktop-ready/page.tsx");
    const card = source("src/components/dashboard-purchase-invoices-stat.tsx");
    const endpoint = source("src/app/api/desktop/dashboard/purchase-invoices-summary/route.ts");
    expect(home).toContain('hasModuleAccess(user.id, "purchases", "READ")');
    expect(home).toContain("canReadPurchases ? <DashboardPurchaseInvoicesStat />");
    expect(card).toContain("/achats/factures?tab=pending");
    expect(card).toContain("Factures à valider");
    expect(card).toContain("parmi les 500 dernières");
    expect(endpoint).toContain('requireModuleRequestContext("purchases", "READ")');
    expect(endpoint).toContain("Cache-Control");
  });

  it("n'invente pas un compteur pour Pennylane non synchronisé", () => {
    const store = source("src/lib/pennylane/purchase-invoice-store.ts");
    expect(store).toContain("readPendingPurchaseInvoiceSummary");
    expect(store).toContain("PAPOT_PENNYLANE");
    expect(store).toContain("ORDER BY external_id DESC LIMIT 501");
    expect(store).toContain("invoiceNeedsPapotValidation(status)");
    expect(store).toContain("imported: false");
    expect(store).toContain("truncated: rows.rows.length > 500");
  });

  it("ouvre directement l'onglet des factures à valider et conserve le bouton manuel", () => {
    const page = source("src/app/achats/factures/page.tsx");
    const workspace = source("src/components/purchase-invoices-workspace.tsx");
    expect(page).toContain('params.tab === "pending" ? "PENDING"');
    expect(page).toContain("<PurchaseInvoicesWorkspace initialTab={initialTab} />");
    expect(workspace).toContain("initialTab?:");
    expect(workspace).toContain('useState<"ALL" | "PENDING" | "APPROVED">(initialTab)');
    expect(workspace).toContain("Actualiser Pennylane");
  });
});
