import { describe, expect, it } from "vitest";
import type { LibraryPayload } from "../src/lib/library/storage";
import {
  insertLibraryComponentIntoQuote,
  insertLibraryOuvrageIntoQuote,
} from "../src/lib/quotes/library-link";
import { parseQuoteModel, type QuoteModel } from "../src/lib/quotes/model";

const sectionId = "11111111-1111-4111-8111-111111111111";
const componentId = "22222222-2222-4222-8222-222222222222";
const labourId = "33333333-3333-4333-8333-333333333333";
const ouvrageId = "44444444-4444-4444-8444-444444444444";
const ouvrageLine1Id = "55555555-5555-4555-8555-555555555555";
const ouvrageLine2Id = "66666666-6666-4666-8666-666666666666";
const insertedLineId = "77777777-7777-4777-8777-777777777777";

function quote(): QuoteModel {
  return parseQuoteModel({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    subject: "Agencement accueil",
    issueDate: "2026-09-14",
    validityDays: 30,
    paymentTerms: "45 jours fin de mois",
    items: [{ id: sectionId, kind: "SECTION", parentId: null, title: "Mobilier" }],
  });
}

function library(): LibraryPayload {
  return {
    schemaVersion: 1,
    components: [
      {
        id: componentId,
        name: "Panneau mélaminé blanc",
        description: "Panneau décor blanc 19 mm.",
        unit: "m²",
        costPriceCents: 4_000,
        marginPercent: 30,
        salePriceCents: 5_200,
      },
      {
        id: labourId,
        name: "Heure atelier",
        description: "Fabrication en atelier.",
        unit: "h",
        costPriceCents: 5_000,
        marginPercent: 30,
        salePriceCents: 6_500,
      },
    ],
    ouvrages: [
      {
        id: ouvrageId,
        name: "Meuble bas mélaminé 2 portes",
        description: "Ouvrage complet prêt à chiffrer.",
        components: [
          { id: ouvrageLine1Id, componentId, quantity: 2 },
          { id: ouvrageLine2Id, componentId: labourId, quantity: 3 },
        ],
      },
    ],
  };
}

function insertedLine(result: QuoteModel) {
  const line = result.items.find((item) => item.id === insertedLineId);
  if (!line || line.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");
  return line;
}

describe("Library to native quote link", () => {
  it("wraps a single Library component inside a quote ouvrage", () => {
    const sourceQuote = quote();
    const result = insertLibraryComponentIntoQuote({
      quote: sourceQuote,
      library: library(),
      componentId,
      lineId: insertedLineId,
      parentId: sectionId,
      quantity: 2.5,
    });

    expect(sourceQuote.items).toHaveLength(1);
    const line = insertedLine(result);
    expect(line).toMatchObject({
      id: insertedLineId,
      kind: "LINE",
      parentId: sectionId,
      description: "Panneau mélaminé blanc",
      unit: "u",
      quantity: 1,
      quantityFormula: null,
      unitPriceCents: 13_000,
      librarySource: {
        schemaVersion: 1,
        kind: "COMPONENT",
        component: { sourceComponentId: componentId },
      },
    });
    expect(line.components).toHaveLength(1);
    expect(line.components?.[0]).toMatchObject({
      description: "Panneau mélaminé blanc",
      unit: "m²",
      quantity: 2.5,
      unitPriceCents: 5_200,
      librarySource: {
        kind: "COMPONENT",
        component: { sourceComponentId: componentId },
      },
    });
  });

  it("keeps the inserted component frozen when the Library later changes", () => {
    const sourceLibrary = library();
    const result = insertLibraryComponentIntoQuote({
      quote: quote(),
      library: sourceLibrary,
      componentId,
      lineId: insertedLineId,
    });

    sourceLibrary.components[0].name = "Panneau modifié après le devis";
    sourceLibrary.components[0].salePriceCents = 99_999;

    const line = insertedLine(result);
    expect(line.description).toBe("Panneau mélaminé blanc");
    expect(line.unitPriceCents).toBe(5_200);
    expect(line.components?.[0].description).toBe("Panneau mélaminé blanc");
    expect(line.components?.[0].unitPriceCents).toBe(5_200);
  });

  it("copies an ouvrage and materializes all of its components in the quote", () => {
    const result = insertLibraryOuvrageIntoQuote({
      quote: quote(),
      library: library(),
      ouvrageId,
      lineId: insertedLineId,
      parentId: sectionId,
    });

    const line = insertedLine(result);
    expect(line).toMatchObject({
      description: "Meuble bas mélaminé 2 portes",
      unit: "u",
      quantity: 1,
      quantityFormula: null,
      unitPriceCents: 29_900,
    });
    expect(line.components).toEqual([
      {
        id: ouvrageLine1Id,
        description: "Panneau mélaminé blanc",
        unit: "m²",
        quantity: 2,
        quantityFormula: null,
        unitPriceCents: 5_200,
        librarySource: {
          schemaVersion: 1,
          kind: "COMPONENT",
          component: {
            sourceComponentId: componentId,
            name: "Panneau mélaminé blanc",
            description: "Panneau décor blanc 19 mm.",
            unit: "m²",
            costPriceCents: 4_000,
            marginPercent: 30,
            salePriceCents: 5_200,
          },
        },
      },
      {
        id: ouvrageLine2Id,
        description: "Heure atelier",
        unit: "h",
        quantity: 3,
        quantityFormula: null,
        unitPriceCents: 6_500,
        librarySource: {
          schemaVersion: 1,
          kind: "COMPONENT",
          component: {
            sourceComponentId: labourId,
            name: "Heure atelier",
            description: "Fabrication en atelier.",
            unit: "h",
            costPriceCents: 5_000,
            marginPercent: 30,
            salePriceCents: 6_500,
          },
        },
      },
    ]);
    expect(line.librarySource).toEqual({
      schemaVersion: 1,
      kind: "OUVRAGE",
      sourceOuvrageId: ouvrageId,
      name: "Meuble bas mélaminé 2 portes",
      description: "Ouvrage complet prêt à chiffrer.",
      costPriceCents: 23_000,
      salePriceCents: 29_900,
      components: [
        {
          sourceLineId: ouvrageLine1Id,
          quantity: 2,
          component: {
            sourceComponentId: componentId,
            name: "Panneau mélaminé blanc",
            description: "Panneau décor blanc 19 mm.",
            unit: "m²",
            costPriceCents: 4_000,
            marginPercent: 30,
            salePriceCents: 5_200,
          },
        },
        {
          sourceLineId: ouvrageLine2Id,
          quantity: 3,
          component: {
            sourceComponentId: labourId,
            name: "Heure atelier",
            description: "Fabrication en atelier.",
            unit: "h",
            costPriceCents: 5_000,
            marginPercent: 30,
            salePriceCents: 6_500,
          },
        },
      ],
    });
  });

  it("keeps an inserted ouvrage frozen when its definition and components later change", () => {
    const sourceLibrary = library();
    const result = insertLibraryOuvrageIntoQuote({
      quote: quote(),
      library: sourceLibrary,
      ouvrageId,
      lineId: insertedLineId,
    });

    sourceLibrary.ouvrages[0].name = "Ouvrage renommé";
    sourceLibrary.ouvrages[0].components[0].quantity = 50;
    sourceLibrary.components[0].name = "Composant renommé";

    const line = insertedLine(result);
    expect(line.description).toBe("Meuble bas mélaminé 2 portes");
    expect(line.unitPriceCents).toBe(29_900);
    expect(line.components?.[0].quantity).toBe(2);
    expect(line.components?.[0].description).toBe("Panneau mélaminé blanc");
  });

  it("fails cleanly when the requested Library item cannot be resolved", () => {
    expect(() =>
      insertLibraryComponentIntoQuote({
        quote: quote(),
        library: library(),
        componentId: "99999999-9999-4999-8999-999999999999",
        lineId: insertedLineId,
      }),
    ).toThrow("QUOTE_LIBRARY_COMPONENT_NOT_FOUND");

    expect(() =>
      insertLibraryOuvrageIntoQuote({
        quote: quote(),
        library: library(),
        ouvrageId: "99999999-9999-4999-8999-999999999999",
        lineId: insertedLineId,
      }),
    ).toThrow("QUOTE_LIBRARY_OUVRAGE_NOT_FOUND");
  });

  it("rejects an invalid inserted quantity and still enforces quote hierarchy", () => {
    expect(() =>
      insertLibraryComponentIntoQuote({
        quote: quote(),
        library: library(),
        componentId,
        lineId: insertedLineId,
        quantity: 0,
      }),
    ).toThrow("QUOTE_LIBRARY_QUANTITY_INVALID");

    expect(() =>
      insertLibraryComponentIntoQuote({
        quote: quote(),
        library: library(),
        componentId,
        lineId: insertedLineId,
        parentId: "99999999-9999-4999-8999-999999999999",
      }),
    ).toThrow("QUOTE_ITEM_PARENT_NOT_FOUND");
  });

  it("requires a quote-owned price whenever a frozen Library source is stored", () => {
    const inserted = insertLibraryComponentIntoQuote({
      quote: quote(),
      library: library(),
      componentId,
      lineId: insertedLineId,
    });
    const line = insertedLine(inserted);
    const withoutPrice = {
      ...inserted,
      items: inserted.items.map((item) => {
        if (item.id !== line.id || item.kind !== "LINE") return item;
        const { unitPriceCents: _unitPriceCents, ...rest } = item;
        return rest;
      }),
    };

    expect(() => parseQuoteModel(withoutPrice)).toThrow("QUOTE_LINE_LIBRARY_PRICE_MISSING");
  });
});
