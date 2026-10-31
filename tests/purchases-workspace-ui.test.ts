import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("écran Bons de commande", () => {
  it("propose fournisseur et chantier, saisie rapide ou détaillée", () => {
    const ui = readFileSync("src/components/purchase-orders-workspace.tsx", "utf8");
    expect(ui).toContain("BC rapide · Montant global");
    expect(ui).toContain("BC détaillé · Articles");
    expect(ui).toContain("Fournisseur du BC");
    expect(ui).toContain("Montant HT du BC rapide");
    expect(ui).toContain("Désignation ligne");
    expect(ui).toContain("Prix unitaire ligne");
    expect(ui).toContain("Ajouter une ligne");
    expect(ui).toContain("Enregistrer le BC (engagement)");
    expect(ui).toContain("Filtrer les BC par chantier");
  });

  it("ne confond pas BC et facture et utilise le droit achats", () => {
    const api = readFileSync("src/app/api/desktop/purchases/route.ts", "utf8");
    const menu = readFileSync("src/lib/desktop/navigation.ts", "utf8");
    const db = readFileSync("src/lib/server-db/migrations.ts", "utf8");
    expect(api).toContain('requireModuleRequestContext("purchases", "READ")');
    expect(api).toContain('requireModuleRequestContext("purchases", "WRITE")');
    expect(menu).toContain('href: "/achats"');
    expect(db).toContain("CREATE TABLE IF NOT EXISTS papot_purchase_orders_state");
    expect(db).toContain("await ensurePurchaseOrdersStorage(client)");
  });
});
