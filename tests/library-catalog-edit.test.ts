import { describe, expect, it } from "vitest";
import {
  libraryComponentUsageCount,
  removeLibraryComponent,
  removeLibraryOuvrage,
  upsertLibraryComponent,
  upsertLibraryOuvrage,
} from "../src/lib/library/catalog-edit";
import type { LibraryPayload } from "../src/lib/library/storage";

function payload(): LibraryPayload {
  return {
    schemaVersion: 1,
    components: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Panneau mélaminé",
        description: "",
        unit: "m²",
        costPriceCents: 10_000,
        marginPercent: 30,
        salePriceCents: 13_000,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Heure atelier",
        description: "",
        unit: "h",
        costPriceCents: 5_000,
        marginPercent: 40,
        salePriceCents: 7_000,
      },
    ],
    ouvrages: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Meuble bas",
        description: "",
        components: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            componentId: "11111111-1111-4111-8111-111111111111",
            quantity: 2,
          },
        ],
      },
    ],
  };
}

describe("Library catalog editing helpers", () => {
  it("adds and updates a component without duplicating its identity", () => {
    const initial = payload();
    const added = upsertLibraryComponent(initial, {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Charnière",
      description: "",
      unit: "u",
      costPriceCents: 1_000,
      marginPercent: 30,
      salePriceCents: 1_300,
    });

    expect(added.components).toHaveLength(3);

    const updated = upsertLibraryComponent(added, {
      ...added.components[2],
      name: "Charnière invisible",
    });

    expect(updated.components).toHaveLength(3);
    expect(updated.components[2].name).toBe("Charnière invisible");
  });

  it("refuses to remove a component still used by an ouvrage", () => {
    expect(() => removeLibraryComponent(payload(), "11111111-1111-4111-8111-111111111111")).toThrow(
      "LIBRARY_COMPONENT_IN_USE",
    );
  });

  it("removes an unused component", () => {
    const result = removeLibraryComponent(payload(), "22222222-2222-4222-8222-222222222222");
    expect(result.components.map((component) => component.id)).toEqual([
      "11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("adds an ouvrage only when its component references exist", () => {
    const initial = payload();
    const next = upsertLibraryOuvrage(initial, {
      id: "66666666-6666-4666-8666-666666666666",
      name: "Habillage",
      description: "",
      components: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          componentId: "22222222-2222-4222-8222-222222222222",
          quantity: 3.5,
        },
      ],
    });

    expect(next.ouvrages).toHaveLength(2);

    expect(() =>
      upsertLibraryOuvrage(initial, {
        id: "88888888-8888-4888-8888-888888888888",
        name: "Invalide",
        description: "",
        components: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            componentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            quantity: 1,
          },
        ],
      }),
    ).toThrow("LIBRARY_OUVRAGE_COMPONENT_NOT_FOUND");
  });

  it("removes an ouvrage without changing the component catalog", () => {
    const initial = payload();
    const result = removeLibraryOuvrage(initial, "33333333-3333-4333-8333-333333333333");
    expect(result.ouvrages).toEqual([]);
    expect(result.components).toEqual(initial.components);
  });

  it("counts component usages across ouvrages", () => {
    const initial = payload();
    expect(libraryComponentUsageCount(initial.ouvrages, initial.components[0])).toBe(1);
    expect(libraryComponentUsageCount(initial.ouvrages, initial.components[1])).toBe(0);
  });
});
