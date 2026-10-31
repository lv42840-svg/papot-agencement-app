import { describe, expect, it } from "vitest";
import {
  addPurchaseOrder,
  cancelPurchaseOrder,
  committedPurchaseTotal,
  committedPurchaseDestinationTotal,
  committedPurchasesByDestination,
  parsePurchaseOrdersPayload,
  purchaseAllocationFromSelection,
  purchaseOrderInputSchema,
  purchaseOrderHistoryForChantier,
  removeChantierPurchaseCommitments,
  updatePurchaseOrder,
  type PurchaseOrderInput,
} from "../src/lib/purchases/domain";
import { purchaseChantierNamesForInput } from "../src/lib/purchases/destination-policy";

const siteId = "11111111-1111-4111-8111-111111111111";
const names = new Map([[siteId, "Chantier A"]]);
const at = new Date("2026-10-20T10:00:00Z");
const later = new Date("2026-10-21T10:00:00Z");
const quick = (
  allocations: Extract<PurchaseOrderInput, { mode: "QUICK" }>["allocations"],
): PurchaseOrderInput => ({
  mode: "QUICK",
  supplierName: "Fournisseur",
  description: "",
  allocations,
});
const mixed = () =>
  addPurchaseOrder(
    parsePurchaseOrdersPayload(null),
    crypto.randomUUID(),
    quick([
      purchaseAllocationFromSelection(siteId, 60000),
      purchaseAllocationFromSelection("SAV", 25000),
      purchaseAllocationFromSelection("GENERAL_EXPENSES", 15000),
    ]),
    names,
    "Lucien",
    at,
  );

describe("destinations des achats", () => {
  it("600 + 250 + 150 = 1000, sans additionner l'en-tete une seconde fois", () => {
    const data = mixed();
    expect(committedPurchaseTotal(data, siteId)).toBe(60000);
    expect(committedPurchaseDestinationTotal(data, "SAV")).toBe(25000);
    expect(committedPurchaseDestinationTotal(data, "GENERAL_EXPENSES")).toBe(15000);
    expect(committedPurchasesByDestination(data)).toEqual({
      chantierCents: 60000,
      savCents: 25000,
      generalExpensesCents: 15000,
      totalCents: 100000,
    });
    expect(parsePurchaseOrdersPayload(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });
  it("cree un achat SAV sans aucun chantier reel ou fictif", () => {
    const data = addPurchaseOrder(
      parsePurchaseOrdersPayload(null),
      crypto.randomUUID(),
      quick([purchaseAllocationFromSelection("SAV", 12345)]),
      new Map(),
      "Nadia",
      at,
    );
    expect(data.orders[0].chantierId).toBeNull();
    expect(data.orders[0].allocations?.[0]).toMatchObject({
      destinationType: "SAV",
      chantierId: null,
    });
    expect(committedPurchaseTotal(data, siteId)).toBe(0);
    expect(committedPurchasesByDestination(data).totalCents).toBe(12345);
  });
  it("retire uniquement la part chantier a la cloture et conserve SAV/FG", () => {
    const before = mixed();
    const data = removeChantierPurchaseCommitments(before, siteId, "Lucien", later);
    expect(data.orders[0].status).toBe("COMMITTED");
    expect(data.orders[0].chantierId).toBeNull();
    expect(data.orders[0].amountHtCents).toBe(40000);
    expect(committedPurchasesByDestination(data)).toEqual({
      chantierCents: 0,
      savCents: 25000,
      generalExpensesCents: 15000,
      totalCents: 40000,
    });
    expect(purchaseOrderHistoryForChantier(data, siteId)[0]).toMatchObject({
      state: "REMOVED",
      amountHtCents: 60000,
    });
    expect(parsePurchaseOrdersPayload(data)).toEqual(data);
    expect(before.orders[0].amountHtCents).toBe(100000);
  });
  it("annule une commande sans supprimer ses affectations historiques", () => {
    const before = mixed();
    const order = before.orders[0];
    const data = cancelPurchaseOrder(before, order.id, order.updatedAt, "Nadia", later);
    expect(committedPurchasesByDestination(data).totalCents).toBe(0);
    expect(data.orders[0].allocations).toEqual(order.allocations);
  });
  it("relit les anciennes commandes rapides et detaillees sans destinationType", () => {
    const data = addPurchaseOrder(
      parsePurchaseOrdersPayload(null),
      crypto.randomUUID(),
      quick([{ chantierId: siteId, amountHtCents: 10000 }]),
      names,
      "Lucien",
      at,
    );
    const legacy = { ...data, orders: [{ ...data.orders[0], allocations: undefined }] };
    expect(committedPurchasesByDestination(parsePurchaseOrdersPayload(legacy)).chantierCents).toBe(
      10000,
    );
    const detailed = addPurchaseOrder(
      parsePurchaseOrdersPayload(null),
      crypto.randomUUID(),
      {
        mode: "DETAILED",
        chantierId: siteId,
        supplierName: "Fournisseur",
        description: "",
        lines: [
          {
            id: crypto.randomUUID(),
            description: "Article",
            unit: "u",
            quantity: 2,
            unitPriceHtCents: 5000,
          },
        ],
      },
      names,
      "Lucien",
      at,
    );
    expect(committedPurchasesByDestination(detailed).totalCents).toBe(10000);
  });
  it("conserve les anciennes destinations lors d'une modification et refuse un ecran perime", () => {
    const before = mixed();
    const old = before.orders[0];
    const input = quick([purchaseAllocationFromSelection("GENERAL_EXPENSES", 100000)]);
    const data = updatePurchaseOrder(before, old.id, old.updatedAt, input, names, "Nadia", later);
    expect(data.orders[0].reference).toBe(old.reference);
    expect(data.orders[0].revisions?.[0].previousAllocations).toEqual(old.allocations);
    expect(committedPurchasesByDestination(data).generalExpensesCents).toBe(100000);
    expect(() =>
      updatePurchaseOrder(data, old.id, old.updatedAt, input, names, "Nadia", later),
    ).toThrow("PURCHASE_ORDER_VERSION_CONFLICT");
  });
  it("refuse destinations contradictoires, doublons et repartition incomplete", () => {
    const sav = purchaseAllocationFromSelection("SAV", 100);
    expect(() => purchaseOrderInputSchema.parse(quick([sav, sav]))).toThrow();
    expect(() =>
      purchaseOrderInputSchema.parse(
        quick([{ destinationType: "SAV", chantierId: siteId, amountHtCents: 100 }]),
      ),
    ).toThrow();
    expect(() =>
      purchaseOrderInputSchema.parse(quick([{ chantierId: null, amountHtCents: 100 }])),
    ).toThrow();
    const data = mixed();
    data.orders[0].amountHtCents += 1;
    expect(() => parsePurchaseOrdersPayload(data)).toThrow();
  });
  it("interdit les nouveaux engagements sur chantier ferme mais garde les anciennes parts", () => {
    const sites = [{ id: siteId, name: "Chantier A", status: "CANCELLED" }];
    const data = mixed();
    const order = data.orders[0];
    const input = quick(order.allocations!);
    expect(() => purchaseChantierNamesForInput(input, sites)).toThrow(
      "PURCHASE_CHANTIER_NOT_ACTIVE",
    );
    expect(() => purchaseChantierNamesForInput(input, sites, order)).not.toThrow();
    expect(() =>
      purchaseChantierNamesForInput(
        quick([purchaseAllocationFromSelection(siteId, 70000)]),
        sites,
        order,
      ),
    ).toThrow("PURCHASE_CHANTIER_NOT_ACTIVE");
    expect(() =>
      purchaseChantierNamesForInput(quick([purchaseAllocationFromSelection("SAV", 100)]), []),
    ).not.toThrow();
    expect(committedPurchasesByDestination(data).chantierCents).toBe(60000);
  });
});
