import { describe, expect, it } from "vitest";
import { createInitialLibraryPayload } from "../src/lib/library/storage";
import {
  publishQuoteComponentToLibrary,
  publishQuoteOuvrageToLibrary,
} from "../src/lib/quotes/library-publish";
import type { QuoteLine } from "../src/lib/quotes/model";

const lineId = "11111111-1111-4111-8111-111111111111";
const firstComponentId = "22222222-2222-4222-8222-222222222222";
const secondComponentId = "33333333-3333-4333-8333-333333333333";

function quoteLine(): QuoteLine {
  return {
    id: lineId,
    kind: "LINE",
    parentId: null,
    description: "Meuble bas 2 portes",
    unit: "u",
    quantity: 1,
    quantityFormula: null,
    unitPriceCents: 29_900,
    components: [
      {
        id: firstComponentId,
        description: "Panneau mélaminé blanc",
        unit: "m²",
        quantity: 2,
        quantityFormula: null,
        costPriceCents: 4_000,
        unitPriceCents: 5_200,
      },
      {
        id: secondComponentId,
        description: "Heure atelier",
        unit: "h",
        quantity: 3,
        quantityFormula: null,
        costPriceCents: 5_000,
        unitPriceCents: 6_500,
      },
    ],
  };
}

function ids() {
  const values = [
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666",
    "77777777-7777-4777-8777-777777777777",
    "88888888-8888-4888-8888-888888888888",
  ];
  return () => {
    const value = values.shift();
    if (!value) throw new Error("TEST_ID_EXHAUSTED");
    return value;
  };
}

function linkedComponent() {
  const sourceComponentId = "99999999-9999-4999-8999-999999999999";
  const sourceComponent = quoteLine().components![0];
  return {
    sourceComponentId,
    component: {
      ...sourceComponent,
      librarySource: {
        schemaVersion: 1 as const,
        kind: "COMPONENT" as const,
        component: {
          sourceComponentId,
          name: "Panneau mélaminé blanc",
          description: "Panneau décor blanc 19 mm.",
          unit: "m²",
          costPriceCents: 4_000,
          marginPercent: 30,
          salePriceCents: 5_200,
        },
      },
    },
  };
}

describe("publish quote component to Library", () => {
  it("creates one reusable component from a quote component", () => {
    const component = quoteLine().components![0];
    const result = publishQuoteComponentToLibrary(createInitialLibraryPayload(), component, ids());

    expect(result.created).toBe(true);
    expect(result.updated).toBe(false);
    expect(result.payload.components).toHaveLength(1);
    expect(result.payload.components[0]).toMatchObject({
      id: result.componentId,
      name: "Panneau mélaminé blanc",
      unit: "m²",
      costPriceCents: 4_000,
      marginPercent: 30,
      salePriceCents: 5_200,
    });
    expect(result.payload.ouvrages).toHaveLength(0);
  });

  it("reuses an unchanged component already coming from the Library", () => {
    const { sourceComponentId, component } = linkedComponent();
    const payload = createInitialLibraryPayload();
    payload.components.push({
      id: sourceComponentId,
      name: "Panneau mélaminé blanc",
      description: "Panneau décor blanc 19 mm.",
      unit: "m²",
      costPriceCents: 4_000,
      marginPercent: 30,
      salePriceCents: 5_200,
    });

    const result = publishQuoteComponentToLibrary(payload, component, ids());

    expect(result.created).toBe(false);
    expect(result.updated).toBe(false);
    expect(result.componentId).toBe(sourceComponentId);
    expect(result.payload.components).toHaveLength(1);
  });

  it("can overwrite the linked Library component with the edited quote pricing", () => {
    const { sourceComponentId, component } = linkedComponent();
    const payload = createInitialLibraryPayload();
    payload.components.push({
      id: sourceComponentId,
      name: "Panneau mélaminé blanc",
      description: "Description Bibliothèque conservée.",
      unit: "m²",
      costPriceCents: 4_000,
      marginPercent: 30,
      salePriceCents: 5_200,
    });
    const edited = { ...component, unitPriceCents: 6_000 };

    const result = publishQuoteComponentToLibrary(
      payload,
      edited,
      ids(),
      "OVERWRITE_LINKED",
    );

    expect(result.created).toBe(false);
    expect(result.updated).toBe(true);
    expect(result.componentId).toBe(sourceComponentId);
    expect(result.payload.components).toHaveLength(1);
    expect(result.payload.components[0]).toMatchObject({
      id: sourceComponentId,
      name: "Panneau mélaminé blanc",
      description: "Description Bibliothèque conservée.",
      costPriceCents: 4_000,
      marginPercent: 50,
      salePriceCents: 6_000,
    });
  });

  it("keeps creating a new component when overwrite is not requested", () => {
    const { sourceComponentId, component } = linkedComponent();
    const payload = createInitialLibraryPayload();
    payload.components.push({
      id: sourceComponentId,
      name: "Panneau mélaminé blanc",
      description: "Panneau décor blanc 19 mm.",
      unit: "m²",
      costPriceCents: 4_000,
      marginPercent: 30,
      salePriceCents: 5_200,
    });

    const result = publishQuoteComponentToLibrary(
      payload,
      { ...component, unitPriceCents: 6_000 },
      ids(),
    );

    expect(result.created).toBe(true);
    expect(result.updated).toBe(false);
    expect(result.componentId).not.toBe(sourceComponentId);
    expect(result.payload.components).toHaveLength(2);
  });
});

describe("publish quote ouvrage to Library", () => {
  it("creates reusable components and one ouvrage from the quote composition", () => {
    const result = publishQuoteOuvrageToLibrary(createInitialLibraryPayload(), quoteLine(), ids());

    expect(result.createdComponentCount).toBe(2);
    expect(result.payload.components).toHaveLength(2);
    expect(result.payload.components[0]).toMatchObject({
      name: "Panneau mélaminé blanc",
      unit: "m²",
      costPriceCents: 4_000,
      marginPercent: 30,
      salePriceCents: 5_200,
    });
    expect(result.payload.components[1]).toMatchObject({
      name: "Heure atelier",
      costPriceCents: 5_000,
      marginPercent: 30,
      salePriceCents: 6_500,
    });
    expect(result.payload.ouvrages).toHaveLength(1);
    expect(result.payload.ouvrages[0]).toMatchObject({
      id: result.ouvrageId,
      name: "Meuble bas 2 portes",
      components: [
        { quantity: 2, componentId: result.payload.components[0].id },
        { quantity: 3, componentId: result.payload.components[1].id },
      ],
    });
  });

  it("reuses an unchanged component already coming from the Library", () => {
    const sourceComponentId = "99999999-9999-4999-8999-999999999999";
    const payload = createInitialLibraryPayload();
    payload.components.push({
      id: sourceComponentId,
      name: "Panneau mélaminé blanc",
      description: "Panneau décor blanc 19 mm.",
      unit: "m²",
      costPriceCents: 4_000,
      marginPercent: 30,
      salePriceCents: 5_200,
    });

    const line = quoteLine();
    line.components = [
      {
        ...line.components![0],
        librarySource: {
          schemaVersion: 1,
          kind: "COMPONENT",
          component: {
            sourceComponentId,
            name: "Panneau mélaminé blanc",
            description: "Panneau décor blanc 19 mm.",
            unit: "m²",
            costPriceCents: 4_000,
            marginPercent: 30,
            salePriceCents: 5_200,
          },
        },
      },
    ];

    const result = publishQuoteOuvrageToLibrary(payload, line, ids());

    expect(result.createdComponentCount).toBe(0);
    expect(result.payload.components).toHaveLength(1);
    expect(result.payload.ouvrages[0].components[0].componentId).toBe(sourceComponentId);
  });

  it("refuses to invent a cost when a quote component has none", () => {
    const line = quoteLine();
    if (!line.components) throw new Error("TEST_COMPONENTS_NOT_FOUND");
    delete line.components[0].costPriceCents;

    expect(() => publishQuoteOuvrageToLibrary(createInitialLibraryPayload(), line, ids())).toThrow(
      "QUOTE_LIBRARY_COMPONENT_COST_REQUIRED",
    );
  });
});
