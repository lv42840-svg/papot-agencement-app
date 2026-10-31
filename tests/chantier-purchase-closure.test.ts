import { describe, expect, it } from "vitest";
import {
  addPurchaseOrder,
  committedOrdersForChantier,
  committedPurchaseTotal,
  parsePurchaseOrdersPayload,
  purchaseCloseReviewToken,
  purchaseOrderHistoryForChantier,
  removeChantierPurchaseCommitments,
} from "../src/lib/purchases/domain";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
const sites = new Map([
  [a, "Chantier A"],
  [b, "Chantier B"],
]);

const snapshot = () => {
  const empty = parsePurchaseOrdersPayload(null);
  const multi = addPurchaseOrder(
    empty,
    crypto.randomUUID(),
    {
      mode: "QUICK",
      supplierName: "Negoce bois",
      description: "",
      allocations: [
        { chantierId: a, amountHtCents: 25_000 },
        { chantierId: b, amountHtCents: 15_000 },
      ],
    },
    sites,
    "Lucien",
    new Date("2026-10-31T15:00:00.000Z"),
  );
  return addPurchaseOrder(
    multi,
    crypto.randomUUID(),
    {
      mode: "DETAILED",
      chantierId: a,
      supplierName: "Quincaillerie",
      description: "",
      lines: [
        {
          id: crypto.randomUUID(),
          description: "Visserie",
          quantity: 2,
          unit: "u",
          unitPriceHtCents: 5_000,
        },
      ],
    },
    sites,
    "Lucien",
    new Date("2026-10-31T15:00:00.000Z"),
  );
};

describe("réconciliation manuelle à la clôture chantier", () => {
  it("reconnaît les engagements du chantier et détecte un changement concurrent", () => {
    const original = snapshot();
    const orders = committedOrdersForChantier(original, a);
    expect(orders).toHaveLength(2);
    expect(orders.reduce((sum, order) => sum + order.amountHtCents, 0)).toBe(35_000);
    const token = purchaseCloseReviewToken(orders);
    const changed = addPurchaseOrder(
      original,
      crypto.randomUUID(),
      {
        mode: "QUICK",
        allocations: [{ chantierId: a, amountHtCents: 900 }],
        supplierName: "Autre",
        description: "",
      },
      sites,
      "Nadia",
      new Date("2026-10-31T15:20:00.000Z"),
    );
    expect(purchaseCloseReviewToken(committedOrdersForChantier(changed, a))).not.toBe(token);
  });

  it("retire uniquement la part du chantier clôturé, préserve les BC et les autres chantiers", () => {
    const original = snapshot();
    const updated = removeChantierPurchaseCommitments(original, a, "Lucien");
    expect(committedPurchaseTotal(original, a)).toBe(35_000);
    expect(committedPurchaseTotal(updated, a)).toBe(0);
    expect(committedPurchaseTotal(updated, b)).toBe(15_000);
    expect(updated.orders).toHaveLength(2);
    expect(updated.orders[0].amountHtCents).toBe(15_000);
    expect(updated.orders[0].allocations).toEqual([
      {
        chantierId: b,
        chantierName: "Chantier B",
        amountHtCents: 15_000,
      },
    ]);
    expect(updated.orders[0].removedAllocations?.[0]).toMatchObject({
      chantierId: a,
      amountHtCents: 25_000,
      removedByName: "Lucien",
    });
    expect(updated.orders[1].status).toBe("CANCELLED");
    expect(updated.orders[1].removedAllocations?.[0].amountHtCents).toBe(10_000);
  });

  it("affiche dans Commandes la part exacte des BC actifs, sans doubler le global", () => {
    const orders = snapshot();
    const onA = purchaseOrderHistoryForChantier(orders, a);
    const onB = purchaseOrderHistoryForChantier(orders, b);
    expect(onA).toHaveLength(2);
    expect(onA.map((item) => item.amountHtCents)).toEqual([25_000, 10_000]);
    expect(onB).toHaveLength(1);
    expect(onB[0].amountHtCents).toBe(15_000);
    expect(onB[0].order.amountHtCents).toBe(40_000);
    expect(onA.every((item) => item.state === "COMMITTED")).toBe(true);
  });

  it("conserve l'historique d'une part retirée même si le BC sert toujours un autre chantier", () => {
    const updated = removeChantierPurchaseCommitments(snapshot(), a, "Lucien");
    const aHistory = purchaseOrderHistoryForChantier(updated, a);
    const bHistory = purchaseOrderHistoryForChantier(updated, b);
    expect(aHistory).toHaveLength(2);
    expect(aHistory.map((item) => item.state)).toEqual(["REMOVED", "REMOVED"]);
    expect(aHistory.map((item) => item.amountHtCents)).toEqual([25_000, 10_000]);
    expect(aHistory.every((item) => item.removedAt !== null)).toBe(true);
    expect(bHistory).toHaveLength(1);
    expect(bHistory[0].state).toBe("COMMITTED");
    expect(bHistory[0].amountHtCents).toBe(15_000);
  });

  it("affiche aussi les BC annulés sans mouvement de fermeture", () => {
    const orders = snapshot();
    orders.orders[0].status = "CANCELLED";
    expect(purchaseOrderHistoryForChantier(orders, b)[0]).toMatchObject({
      amountHtCents: 15_000,
      state: "CANCELLED",
    });
    const legacy = snapshot();
    delete legacy.orders[0].allocations;
    // The historical one-chantier format remains supported.
    expect(purchaseOrderHistoryForChantier(legacy, a)[0].amountHtCents).toBe(40_000);
  });

  it("n'annule jamais un BC déjà retiré sur un autre chantier", () => {
    const first = removeChantierPurchaseCommitments(snapshot(), a, "Lucien");
    const repeated = removeChantierPurchaseCommitments(first, a, "Lucien");
    expect(repeated).toEqual(first);
    expect(committedPurchaseTotal(repeated, b)).toBe(15_000);
    const final = removeChantierPurchaseCommitments(repeated, b, "Nadia");
    expect(final.orders[0].status).toBe("CANCELLED");
    expect(committedPurchaseTotal(final, b)).toBe(0);
  });
});
