import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const file = (name: string) => readFileSync(name, "utf8");

describe("Accueil Facturation lisible et séparé de l'émission officielle", () => {
  it("ouvre un véritable accueil à 4 actions, pas l'ancienne liste de projets", () => {
    const workspace = file("src/components/billing-workspace.tsx");
    const cards = file("src/components/billing-hub-cards.tsx");
    expect(workspace).toContain(': "HOME"');
    expect(workspace).toContain('<BillingHubCards');
    expect(workspace).toContain('tab === "HOME"');
    expect(workspace).toContain('tab === "ISSUED"');
    expect(cards).toContain("Créer une facture");
    expect(cards).toContain("À valider");
    expect(cards).toContain("Factures émises");
    expect(cards).toContain("Mode TEST");
    expect(cards).toContain("disabled={!testEnabled}");
  });

  it("distingue les projets non émis du registre officiel et des avoirs", () => {
    const workspace = file("src/components/billing-workspace.tsx");
    const route = file("src/app/api/desktop/billing/route.ts");
    expect(workspace).toContain("const issuedIds = new Set(");
    expect(workspace).toContain("filterBillingProjects(unissuedDrafts");
    expect(workspace).toContain("Factures émises dans PAPOT");
    expect(workspace).toContain('"/api/desktop/billing/issued/"');
    expect(workspace).toContain('"/api/desktop/billing/credits/issued/"');
    expect(workspace).toContain("Après avoirs");
    expect(route).toContain("clientName: invoice.buyer.name");
    expect(route).toContain("totalTtcCents: invoice.totalTtcCents");
    expect(route).toContain("creditPositions:");
    expect(route).toContain("delete safe.testSandbox");
  });

  it("corrige les textes trompeurs de l'onglet Facturation du chantier", () => {
    const tab = file("src/components/chantier-billing-tab.tsx");
    expect(tab).toContain("Factures émises sur ce chantier");
    expect(tab).toContain("issuedDraftIds.has(draft.id)");
    expect(tab).toContain("Télécharger le PDF officiel");
    expect(tab).not.toContain("PAPOT ne délivre encore");
    expect(tab).not.toContain("Factures officiellement émises : non disponibles");
  });

  it("conserve les restrictions d'émission et d'accès au bac à sable", () => {
    const route = file("src/app/api/desktop/billing/route.ts");
    const cards = file("src/components/billing-hub-cards.tsx");
    const sandbox = file("src/app/api/desktop/billing/test-sandbox/route.ts");
    expect(route).toContain('PAPOT_NATIVE_BILLING_ISSUANCE_ENABLED === "true"');
    expect(route).toContain('PAPOT_BILLING_TEST_SANDBOX_ENABLED === "true"');
    expect(cards).toContain("Accès non activé");
    expect(sandbox).toContain('requireSpecialPermission(context.user, "billing.reset_test_sandbox")');
  });
});
