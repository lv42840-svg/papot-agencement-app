import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const home = readFileSync("src/app/desktop-ready/page.tsx", "utf8");
const card = readFileSync("src/components/dashboard-invoiced-stat.tsx", "utf8");
const route = readFileSync("src/app/api/desktop/dashboard/invoiced-summary/route.ts", "utf8");
const billing = readFileSync("src/components/billing-workspace.tsx", "utf8");

describe("accueil : chiffre d'affaires réellement facturé", () => {
  it("ne compte plus les devis confirmés en CA du mois", () => {
    expect(home).toContain("<DashboardInvoicedStat />");
    expect(home).not.toContain("<DashboardSoldMarginStat />");
    expect(card).toContain("Chiffre d&apos;affaires facturé HT");
    expect(card).toContain("Non disponible");
    expect(card).toContain("Pennylane non raccordé");
    expect(card).toContain("Les devis acceptés et projets de factures ne sont pas comptés dans le CA");
    expect(card).toContain("/api/desktop/dashboard/invoiced-summary");
    expect(card).not.toContain("/api/desktop/dashboard/sold-summary");
  });

  it("protège le CA par les droits Pilotage et Facturation", () => {
    expect(route).toContain('requireModuleRequestContext("pilotage", "READ")');
    expect(route).toContain('requireModuleRequestContext("billing", "READ")');
    expect(route).toContain('requireSpecialPermission(context.user, "dashboard.view_global")');
    expect(route).toContain("summarizeIssuedInvoices([], false)");
    expect(route).toContain("Cache-Control");
  });

  it("accède au suivi des devis acceptés mais ne les présente pas comme facturés", () => {
    expect(card).toContain("/facturation?tab=FOLLOWUP");
    expect(billing).toContain('["FOLLOWUP", `Devis à facturer (${followup.length})`]');
    expect(billing).toContain("Préparation partielle");
    expect(billing).toContain("Reste à préparer HT");
    expect(billing).toContain("À rapprocher avec Pennylane");
    expect(billing).toContain("projets PAPOT non émis");
  });
});
