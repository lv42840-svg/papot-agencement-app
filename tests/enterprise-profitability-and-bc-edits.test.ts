import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { companyProfitabilityTotals, type CompanyProfitabilityRow } from "../src/lib/pilotage/company-profitability";

const example: CompanyProfitabilityRow = {
  chantierId: "11111111-1111-4111-8111-111111111111",
  name: "Test",
  clientName: "Client",
  status: "ACTIVE",
  launchYear: 2026,
  soldCents: 100_000,
  plannedLaborCostCents: 17_000,
  plannedOtherCostCents: 40_000,
  plannedTotalCostCents: 57_000,
  plannedMarginCents: 43_000,
  plannedPurchasesCents: 40_000,
  committedPurchasesCents: 45_000,
  plannedHours: 6,
  actualHours: 8,
  missingData: false,
};

describe("rentabilité entreprise", () => {
  it("additionne la marge une seule fois à partir du coût total heures comprises", () => {
    const totals = companyProfitabilityTotals([example, { ...example, chantierId: "22222222-2222-4222-8222-222222222222" }]);
    expect(totals.soldCents).toBe(200_000);
    expect(totals.plannedLaborCostCents).toBe(34_000);
    expect(totals.plannedTotalCostCents).toBe(114_000);
    expect(totals.plannedMarginCents).toBe(86_000);
    expect(totals.committedPurchasesCents).toBe(90_000);
    expect(totals.plannedHours).toBe(12);
    expect(totals.actualHours).toBe(16);
  });

  it("ne présente pas des totaux financiers partiels comme une marge de l'entreprise", () => {
    const totals = companyProfitabilityTotals([example, {
      ...example, chantierId: "22222222-2222-4222-8222-222222222222",
      plannedLaborCostCents: null, plannedTotalCostCents: null, plannedMarginCents: null,
      missingData: true,
    }]);
    expect(totals.incompleteCount).toBe(1);
    expect(totals.plannedLaborCostCents).toBeNull();
    expect(totals.plannedTotalCostCents).toBeNull();
    expect(totals.plannedMarginCents).toBeNull();
  });

  it("sécurise l'accès global et montre chaque chantier sans facturation fictive", () => {
    const route = readFileSync("src/app/api/desktop/pilotage/rentabilite/route.ts", "utf8");
    const page = readFileSync("src/app/pilotage/rentabilite/page.tsx", "utf8");
    const menu = readFileSync("src/lib/desktop/navigation.ts", "utf8");
    const ui = readFileSync("src/components/enterprise-profitability-workspace.tsx", "utf8");
    expect(route).toContain('requireModuleRequestContext("pilotage", "READ")');
    expect(route).toContain('requireSpecialPermission(context.user, "dashboard.view_global")');
    expect(route).toContain('requireModuleRequestContext("purchases", "READ")');
    expect(page).toContain("EnterpriseProfitabilityWorkspace");
    expect(menu).toContain('href: "/pilotage/rentabilite"');
    expect(ui).toContain("Coût des heures prévues");
    expect(ui).toContain("Marge prévue HT");
    expect(ui).toContain("Coûts à compléter");
    expect(ui).toContain("Les achats engagés sont des BC");
  });

  it("les corrections de BC restent protégées par droits et contrôle de version", () => {
    const api = readFileSync("src/app/api/desktop/purchases/route.ts", "utf8");
    const ui = readFileSync("src/components/purchase-order-edit-workspace.tsx", "utf8");
    const pdf = readFileSync("src/lib/purchases/pdf.ts", "utf8");
    expect(api).toContain('action: z.literal("UPDATE")');
    expect(api).toContain('requireModuleRequestContext("purchases", "WRITE")');
    expect(ui).toContain("expectedUpdatedAt: original.updatedAt");
    expect(ui).toContain("Enregistrer les modifications");
    expect(ui).toContain("Ajouter un chantier");
    expect(ui).toContain("Ajouter un article");
    expect(pdf).not.toContain("Document interne - non envoye automatiquement au fournisseur");
  });
});
