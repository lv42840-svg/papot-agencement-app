import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(
  new URL("../src/components/chantier-workspace.tsx", import.meta.url),
  "utf-8",
);
const panel = readFileSync(
  new URL("../src/components/chantier-profitability-panel.tsx", import.meta.url),
  "utf-8",
);
const engine = readFileSync(
  new URL("../src/lib/chantiers/profitability.ts", import.meta.url),
  "utf-8",
);

describe("chantier profitability UI", () => {
  it("exposes a dedicated global profitability tab", () => {
    expect(workspace).toContain('{ id: "profitability", label: "Rentabilité", icon: BadgeEuro }');
    expect(workspace).toContain("<ChantierProfitabilityPanel");
    expect(panel).toContain("Rentabilité globale du chantier");
    expect(panel).toContain("sans rentabilité ligne par ligne");
  });

  it("shows sold, planned debourse, hours, actual costs and margins", () => {
    expect(panel).toContain("Vendu prévu HT");
    expect(panel).toContain("Achats et frais prévus (hors heures)");
    expect(panel).toContain("Coût des heures prévues");
    expect(panel).toContain("Coût total prévu");
    expect(panel).toContain("Marge prévue");
    expect(panel).toContain("Marge réelle");
    expect(panel).toContain("Prévisionnel depuis le devis");
    expect(panel).toContain("Réalisé à ce jour");
    expect(panel).toContain("Facturé client HT");
    expect(panel).toContain("Achats et frais réels HT");
    expect(panel).toContain("Coût des heures réalisées");
    expect(panel).toContain("Coût total réel");
    expect(panel).toContain("result.actualLaborCostCents");
    expect(panel).toContain("result.actualPurchaseCostCents");
    expect(panel).toContain("result.actualTotalCostCents");
    expect(panel.indexOf("Prévisionnel depuis le devis")).toBeLessThan(
      panel.indexOf("Réalisé à ce jour"),
    );
    expect(panel).toContain("Heures prévues depuis le devis");
    expect(panel).toContain("Achats prévus extraits du devis");
    expect(panel).toContain("plannedPurchaseLines.map");
    expect(panel).toContain("Achats engagés (BC) HT");
    expect(panel).toContain("Écart engagé - prévu HT");
  });

  it("does not invent actual costs while their source modules are absent", () => {
    expect(panel).toContain("Coût employeur manquant pour un mois clos ou son mois précédent");
    expect(panel).toContain("En attente du rapprochement Pennylane");
    expect(panel).toContain("actualLaborCostProvisional");
    expect(engine).toContain("laborCostCents: null");
    expect(engine).toContain("purchaseCostCents: null");
  });

  it("keeps actual margin independent from chantier active/read-only state", () => {
    expect(panel).not.toContain("ARCHIVED");
    expect(panel).not.toContain("ACTIVE");
    expect(engine).not.toContain("chantier.status");
  });
});
