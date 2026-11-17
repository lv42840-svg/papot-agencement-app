import { describe, expect, it } from "vitest";
import { parsePurchaseOrdersPayload, addPurchaseOrder } from "../src/lib/purchases/domain";

describe("préférence fournisseur FG locale", () => {
  it("préserve les données anciennes sans préférences", () => {
    expect(
      parsePurchaseOrdersPayload({ schemaVersion: 1, nextNumber: 1, orders: [] })
        .supplierPreferences,
    ).toBeUndefined();
  });
  it("conserve la préférence par identifiant Pennylane sans créer de fiche fournisseur", () => {
    const payload = parsePurchaseOrdersPayload({
      schemaVersion: 1,
      nextNumber: 1,
      orders: [],
      supplierPreferences: [
        { supplierPennylaneId: "12345", defaultDestination: "GENERAL_EXPENSES" },
      ],
    });
    expect(payload.supplierPreferences?.[0]?.supplierPennylaneId).toBe("12345");
    const next = addPurchaseOrder(
      payload,
      crypto.randomUUID(),
      {
        mode: "QUICK",
        allocations: [
          {
            destinationType: "CHANTIER",
            chantierId: "11111111-1111-4111-8111-111111111111",
            amountHtCents: 1000,
          },
        ],
        supplierName: "Test",
        supplierPennylaneId: "12345",
        description: "Exception chantier",
      },
      new Map([["11111111-1111-4111-8111-111111111111", "Atelier"]]),
      "Lucien",
    );
    expect(next.orders[0]?.chantierName).toBe("Atelier");
    expect(next.supplierPreferences).toEqual(payload.supplierPreferences);
  });
  it("refuse des identifiants fournisseur incorrects", () => {
    expect(() =>
      parsePurchaseOrdersPayload({
        schemaVersion: 1,
        nextNumber: 1,
        orders: [],
        supplierPreferences: [
          { supplierPennylaneId: "faux", defaultDestination: "GENERAL_EXPENSES" },
        ],
      }),
    ).toThrow();
  });
});
