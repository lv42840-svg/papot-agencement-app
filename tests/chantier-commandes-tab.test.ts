import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("onglet Commandes dans la fiche Chantier", () => {
  const chantier = readFileSync("src/components/chantier-workspace.tsx", "utf8");
  const tab = readFileSync("src/components/chantier-commandes-tab.tsx", "utf8");
  const purchases = readFileSync("src/components/purchase-orders-workspace.tsx", "utf8");

  it("ajoute un onglet indépendant des Factures et de Rentabilité", () => {
    expect(chantier).toContain('{ id: "commandes", label: "Commandes", icon: ShoppingCart }');
    expect(chantier).toContain("<ChantierCommandesTab chantierId={chantier.id} />");
    expect(chantier).toContain('{ id: "billing", label: "Factures", icon: FileText }');
  });

  it("affiche les BC rapides et détaillés associés, actifs ou historiques", () => {
    expect(tab).toContain("purchaseOrderHistoryForChantier");
    expect(tab).toContain('fetch("/api/desktop/purchases"');
    expect(tab).toContain("HT engagés sur ce chantier");
    expect(tab).toContain("HT chantier");
    expect(tab).toContain("Facture fournisseur");
    expect(tab).toContain("À raccorder (Pennylane)");
    expect(tab).toContain("Télécharger le PDF");
    expect(tab).toContain("/api/desktop/purchases/");
    expect(tab).toContain("Voir le BC");
    expect(tab).toContain("Retirés à la clôture");
    expect(tab).toContain("Annulés");
  });

  it("ouvre Achats avec le chantier pré-sélectionné et filtré", () => {
    expect(tab).toContain("/achats?chantierId=");
    expect(purchases).toContain('useState(chantierId ?? "ALL")');
  });
});
