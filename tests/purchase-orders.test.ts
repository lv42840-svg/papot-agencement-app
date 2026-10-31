import { describe, expect, it } from "vitest";
import {
  addPurchaseOrder,
  cancelPurchaseOrder,
  committedPurchaseTotal,
  parsePurchaseOrdersPayload,
  purchaseOrderAmount,
  purchaseOrderInputSchema,
} from "../src/lib/purchases/domain";

const chantierId = "11111111-1111-4111-8111-111111111111";
const supplierName = "Fournisseur test";
const quick = {
  mode: "QUICK" as const,
  chantierId,
  supplierName,
  description: "Quincaillerie globale",
  amountHtCents: 500_00,
};
const detailed = {
  mode: "DETAILED" as const,
  chantierId,
  supplierName,
  description: "Fournitures",
  lines: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      description: "Panneaux",
      quantity: 3,
      unit: "m²",
      unitPriceHtCents: 120_00,
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      description: "Charnières",
      quantity: 8,
      unit: "u",
      unitPriceHtCents: 15_50,
    },
  ],
};
const empty = () => parsePurchaseOrdersPayload(null);

describe("bons de commande engagés, sans rapprochement comptable", () => {
  it("enregistre un BC rapide au coût global et sans lignes artificielles", () => {
    const result = addPurchaseOrder(
      empty(),
      crypto.randomUUID(),
      quick,
      "Chantier test",
      "Nadia",
      new Date("2026-10-31T14:00:00.000Z"),
    );
    expect(result.orders[0]).toMatchObject({
      reference: "BC-000001",
      mode: "QUICK",
      chantierId,
      supplierName,
      amountHtCents: 50_000,
      quickAmountHtCents: 50_000,
      lines: [],
      status: "COMMITTED",
    });
    expect(committedPurchaseTotal(result, chantierId)).toBe(50_000);
  });

  it("valorise chaque ligne et cumule les BC d'un même chantier", () => {
    const p1 = addPurchaseOrder(empty(), crypto.randomUUID(), quick, "Chantier A", "Lucien");
    const p2 = addPurchaseOrder(p1, crypto.randomUUID(), detailed, "Chantier A", "Lucien");
    expect(purchaseOrderAmount(detailed)).toBe(48_400);
    expect(p2.orders.map((x) => x.reference)).toEqual(["BC-000001", "BC-000002"]);
    expect(p2.orders[1].lines).toHaveLength(2);
    expect(p2.orders[1].amountHtCents).toBe(48_400);
    expect(committedPurchaseTotal(p2, chantierId)).toBe(98_400);
  });

  it("évite les duplications lors d'un nouvel envoi de la même requête", () => {
    const requestId = crypto.randomUUID();
    const first = addPurchaseOrder(empty(), requestId, quick, "Chantier A", "Lucien");
    const duplicate = addPurchaseOrder(first, requestId, quick, "Chantier A", "Lucien");
    expect(duplicate).toEqual(first);
    expect(duplicate.orders).toHaveLength(1);
  });

  it("annule sans effacer et retire l'engagement, avec contrôle de version", () => {
    const first = addPurchaseOrder(empty(), crypto.randomUUID(), quick, "A", "Lucien");
    const previous = first.orders[0];
    expect(() =>
      cancelPurchaseOrder(first, previous.id, "2020-01-01T00:00:00.000Z", "Lucien"),
    ).toThrow("PURCHASE_ORDER_VERSION_CONFLICT");
    const cancelled = cancelPurchaseOrder(
      first,
      previous.id,
      previous.updatedAt,
      "Lucien",
      new Date(Date.parse(previous.updatedAt) + 1000),
    );
    expect(cancelled.orders[0].status).toBe("CANCELLED");
    expect(committedPurchaseTotal(cancelled, chantierId)).toBe(0);
    expect(cancelled.orders).toHaveLength(1);
  });

  it("refuse un fournisseur vide et un BC détaillé sans lignes", () => {
    expect(purchaseOrderInputSchema.safeParse({ ...quick, supplierName: "" }).success).toBe(false);
    expect(purchaseOrderInputSchema.safeParse({ ...detailed, lines: [] }).success).toBe(false);
    expect(() =>
      purchaseOrderAmount({
        ...detailed,
        lines: [
          {
            ...detailed.lines[0],
            unitPriceHtCents: 0,
          },
        ],
      }),
    ).toThrow("PURCHASE_ORDER_AMOUNT_INVALID");
  });
});
