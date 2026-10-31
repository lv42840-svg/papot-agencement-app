import { describe, expect, it } from "vitest";
import { addPurchaseOrder, parsePurchaseOrdersPayload } from "../src/lib/purchases/domain";
import { generateDetailedPurchaseOrderPdf } from "../src/lib/purchases/pdf";

const chantierId = "11111111-1111-4111-8111-111111111111";
const names = new Map([[chantierId, "Chantier de Lyon"]]);
const detailed = {
  mode: "DETAILED" as const,
  chantierId,
  supplierName: "Fournisseur Éléments & Fils",
  description: "Livraison des composants pour chantier, tarif HT.",
  lines: [{
    id: "22222222-2222-4222-8222-222222222222",
    description: "Panneaux mélaminés (blanc) - 1 200 mm",
    quantity: 3,
    unit: "m²",
    unitPriceHtCents: 125_00,
  }],
};

describe("PDF de bon de commande détaillé", () => {
  it("génère un PDF à télécharger avec référence fournisseur, chantier, lignes et total HT", () => {
    const payload = addPurchaseOrder(
      parsePurchaseOrdersPayload(null),
      crypto.randomUUID(),
      detailed,
      names,
      "Lucien",
    );
    const order = payload.orders[0];
    const bytes = generateDetailedPurchaseOrderPdf(order);
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Type /Page ");
    expect(text).toContain("xref\n0 ");
    expect(text).toContain("%%EOF");
    expect(text).toContain("BC-000001");
    expect(text).toContain("Fournisseur");
    expect(text).toContain("Panneaux");
    expect(text).toContain("375,00 EUR");
    expect(text).toContain("NON ENVOYE");
    expect(order.amountHtCents).toBe(37500);
  });

  it("gère un document de plusieurs pages sans perdre les lignes", () => {
    const lines = Array.from({ length: 90 }, (_, i) => ({
      ...detailed.lines[0],
      id: crypto.randomUUID(),
      description: `Article ${i + 1} : quincaillerie sur mesure pour les ouvrages`,
      quantity: 1,
      unitPriceHtCents: 250,
    }));
    const payload = addPurchaseOrder(
      parsePurchaseOrdersPayload(null),
      crypto.randomUUID(),
      { ...detailed, lines },
      names,
      "Nadia",
    );
    const text = Buffer.from(generateDetailedPurchaseOrderPdf(payload.orders[0])).toString("latin1");
    const count = Number(text.match(/\/Type \/Pages \/Count (\d+)/)?.[1] ?? 0);
    expect(count).toBeGreaterThan(1);
    expect(text).toContain("Article 90");
    expect(text).toContain("225,00 EUR");
  });

  it("refuse de produire un PDF de BC rapide", () => {
    const payload = addPurchaseOrder(
      parsePurchaseOrdersPayload(null),
      crypto.randomUUID(),
      {
        mode: "QUICK",
        supplierName: "Test",
        description: "",
        allocations: [{ chantierId, amountHtCents: 100_00 }],
      },
      names,
      "Lucien",
    );
    expect(() => generateDetailedPurchaseOrderPdf(payload.orders[0]))
      .toThrow("PURCHASE_ORDER_PDF_DETAILED_ONLY");
  });
});
