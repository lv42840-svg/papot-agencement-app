import { describe, expect, it } from "vitest";
import {
  addPurchaseOrder,
  cancelPurchaseOrder,
  updatePurchaseOrder,
  committedPurchaseTotal,
  parsePurchaseOrdersPayload,
  purchaseOrderAmount,
  purchaseOrderInputSchema,
} from "../src/lib/purchases/domain";

const chantierId = "11111111-1111-4111-8111-111111111111";
const supplierName = "Fournisseur test";
const secondChantierId = "44444444-4444-4444-8444-444444444444";
const names = new Map([
  [chantierId, "Chantier A"],
  [secondChantierId, "Chantier B"],
]);
const quick = {
  mode: "QUICK" as const,
  allocations: [{ chantierId, amountHtCents: 500_00 }],
  supplierName,
  description: "Quincaillerie globale",
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
      names,
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
      allocations: [{ chantierId, chantierName: "Chantier A", amountHtCents: 50_000 }],
      lines: [],
      status: "COMMITTED",
    });
    expect(committedPurchaseTotal(result, chantierId)).toBe(50_000);
  });

  it("valorise chaque ligne et cumule les BC d'un même chantier", () => {
    const p1 = addPurchaseOrder(empty(), crypto.randomUUID(), quick, names, "Lucien");
    const p2 = addPurchaseOrder(p1, crypto.randomUUID(), detailed, names, "Lucien");
    expect(purchaseOrderAmount(detailed)).toBe(48_400);
    expect(p2.orders.map((x) => x.reference)).toEqual(["BC-000001", "BC-000002"]);
    expect(p2.orders[1].lines).toHaveLength(2);
    expect(p2.orders[1].amountHtCents).toBe(48_400);
    expect(committedPurchaseTotal(p2, chantierId)).toBe(98_400);
  });

  it("évite les duplications lors d'un nouvel envoi de la même requête", () => {
    const requestId = crypto.randomUUID();
    const first = addPurchaseOrder(empty(), requestId, quick, names, "Lucien");
    const duplicate = addPurchaseOrder(first, requestId, quick, names, "Lucien");
    expect(duplicate).toEqual(first);
    expect(duplicate.orders).toHaveLength(1);
  });

  it("ventile un BC rapide unique sur plusieurs chantiers, sans multiplier le coût", () => {
    const multi = {
      ...quick,
      allocations: [
        { chantierId, amountHtCents: 25_000 },
        { chantierId: secondChantierId, amountHtCents: 15_000 },
      ],
    };
    const saved = addPurchaseOrder(empty(), crypto.randomUUID(), multi, names, "Lucien");
    expect(saved.orders).toHaveLength(1);
    expect(saved.orders[0].amountHtCents).toBe(40_000);
    expect(saved.orders[0].allocations).toHaveLength(2);
    expect(committedPurchaseTotal(saved, chantierId)).toBe(25_000);
    expect(committedPurchaseTotal(saved, secondChantierId)).toBe(15_000);
    expect(committedPurchaseTotal(saved, "55555555-5555-4555-8555-555555555555")).toBe(0);
    expect(() =>
      addPurchaseOrder(
        saved,
        crypto.randomUUID(),
        multi,
        new Map([[chantierId, "Chantier A"]]),
        "Lucien",
      ),
    ).toThrow("PURCHASE_CHANTIER_NOT_FOUND");
  });

  it("refuse deux fois le même chantier et conserve les anciens BC mono-chantier", () => {
    expect(
      purchaseOrderInputSchema.safeParse({
        ...quick,
        allocations: [
          { chantierId, amountHtCents: 5_000 },
          { chantierId, amountHtCents: 3_000 },
        ],
      }).success,
    ).toBe(false);
    const saved = addPurchaseOrder(empty(), crypto.randomUUID(), quick, names, "Lucien");
    const old = JSON.parse(JSON.stringify(saved)) as typeof saved;
    delete old.orders[0].allocations;
    const loaded = parsePurchaseOrdersPayload(old);
    expect(committedPurchaseTotal(loaded, chantierId)).toBe(50_000);
    expect(committedPurchaseTotal(loaded, secondChantierId)).toBe(0);
  });

  it("annule sans effacer et retire l'engagement, avec contrôle de version", () => {
    const first = addPurchaseOrder(empty(), crypto.randomUUID(), quick, names, "Lucien");
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

  it("modifie un BC rapide multi-chantiers, conserve la référence et l'historique", () => {
    const initial = addPurchaseOrder(empty(), crypto.randomUUID(), quick, names, "Lucien",
      new Date("2026-10-30T09:00:00.000Z"));
    const old = initial.orders[0];
    const updated = updatePurchaseOrder(initial, old.id, old.updatedAt, {
      mode: "QUICK",
      supplierName: "Autre fournisseur",
      description: "Rectification de la répartition",
      allocations: [
        { chantierId, amountHtCents: 12_000 },
        { chantierId: secondChantierId, amountHtCents: 23_000 },
      ],
    }, names, "Nadia", new Date("2026-10-31T10:00:00.000Z"));
    expect(updated.orders).toHaveLength(1);
    expect(updated.orders[0].reference).toBe(old.reference);
    expect(updated.orders[0].amountHtCents).toBe(35_000);
    expect(committedPurchaseTotal(updated, chantierId)).toBe(12_000);
    expect(committedPurchaseTotal(updated, secondChantierId)).toBe(23_000);
    expect(updated.orders[0].revisions).toHaveLength(1);
    expect(updated.orders[0].revisions?.[0].previousAmountHtCents).toBe(50_000);
    expect(updated.orders[0].updatedByName).toBe("Nadia");
    expect(() => updatePurchaseOrder(updated, old.id, old.updatedAt, quick, names, "Nadia"))
      .toThrow("PURCHASE_ORDER_VERSION_CONFLICT");
  });

  it("modifie les lignes d'un BC détaillé mais interdit de changer son type", () => {
    const original = addPurchaseOrder(empty(), crypto.randomUUID(), detailed, names, "Lucien");
    const previous = original.orders[0];
    const result = updatePurchaseOrder(original, previous.id, previous.updatedAt, {
      ...detailed,
      lines: [{ ...detailed.lines[0], quantity: 5 }],
    }, names, "Nadia");
    expect(result.orders[0].amountHtCents).toBe(60_000);
    expect(result.orders[0].lines).toHaveLength(1);
    expect(() => updatePurchaseOrder(original, previous.id, previous.updatedAt, quick, names, "Nadia"))
      .toThrow("PURCHASE_ORDER_MODE_IMMUTABLE");
    const cancelled = cancelPurchaseOrder(original, previous.id, previous.updatedAt, "Nadia");
    expect(() => updatePurchaseOrder(cancelled, previous.id, cancelled.orders[0].updatedAt, detailed, names, "Nadia"))
      .toThrow("PURCHASE_ORDER_NOT_EDITABLE");
  });

  it("refuse un fournisseur vide et un BC détaillé sans lignes", () => {
    expect(purchaseOrderInputSchema.safeParse({ ...quick, supplierName: "" }).success).toBe(false);
    expect(purchaseOrderInputSchema.safeParse({ ...quick, allocations: [] }).success).toBe(false);
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
