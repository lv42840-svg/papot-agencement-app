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
    expect(panel).toContain("Vendu HT");
    expect(panel).toContain("Déboursé prévu");
    expect(panel).toContain("Marge prévue");
    expect(panel).toContain("Marge réelle");
    expect(panel).toContain("Heures chantier");
    expect(panel).toContain("Achats / commandes");
  });

  it("does not invent actual costs while their source modules are absent", () => {
    expect(panel).toContain("Module Heures / coûts mensuels non raccordé");
    expect(panel).toContain("Module Achats / commandes non raccordé");
    expect(engine).toContain("laborCostCents: null");
    expect(engine).toContain("purchaseCostCents: null");
  });

  it("keeps actual margin independent from chantier active/read-only state", () => {
    expect(panel).not.toContain("ARCHIVED");
    expect(panel).not.toContain("ACTIVE");
    expect(engine).not.toContain("chantier.status");
  });
});
