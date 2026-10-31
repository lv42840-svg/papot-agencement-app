import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Facturation depuis devis et chantier : avancement par ligne", () => {
  it("présente le mode de situation cumulée par ligne et les états précédents", () => {
    const view = readFileSync("src/components/billing-workspace.tsx", "utf8");
    expect(view).toContain('value="LINES"');
    expect(view).toContain("Avancement par ligne (%)");
    expect(view).toContain("Avancement précédent");
    expect(view).toContain("cumulativeLinesCents");
    expect(view).toContain("linePercentages = rows");
    expect(view).toContain("Avancement cumulé :");
    const editor = readFileSync("src/components/billing-document-editor.tsx", "utf8");
    expect(editor).toContain("Déjà préparé sur ce devis");
  });

  it("conserve le parcours chantier et bloque toute émission comptable", () => {
    const devis = readFileSync("src/components/quote-direct-editor.tsx", "utf8");
    const chantier = readFileSync("src/components/chantier-workspace.tsx", "utf8");
    const ui = readFileSync("src/components/billing-workspace.tsx", "utf8");
    expect(devis).toContain("/facturation?quoteId=");
    expect(chantier).toContain("ChantierBillingTab");
    const tab = readFileSync("src/components/chantier-billing-tab.tsx", "utf8");
    expect(tab).toContain("/facturation?chantierId=");
    expect(ui).toContain("Aucune facture officielle émise.");
  });
});
