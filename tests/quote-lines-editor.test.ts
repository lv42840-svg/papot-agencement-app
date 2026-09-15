import { describe, expect, it } from "vitest";
import { createLibraryComponentFromQuoteLine } from "../src/lib/quotes/library-component";
import { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";
import { createInitialNativeQuotesPayload } from "../src/lib/quotes/store";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};
const affairId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";

function draft() {
  return applyQuotesMutation(
    createInitialNativeQuotesPayload(),
    quotesMutationSchema.parse({
      action: "createDraft",
      commercialCaseId: affairId,
      subject: "Agencement accueil",
      issueDate: "2026-09-14",
      paymentTerms: "45 jours fin de mois",
    }),
    actor,
    clientId,
  );
}

function lineInput(quoteId: string, extra: Record<string, unknown> = {}) {
  return quotesMutationSchema.parse({
    action: "upsertLine",
    quoteId,
    description: "Caisson mélaminé",
    unit: "u",
    quantityInput: "2+3",
    unitPriceCents: 25_000,
    ...extra,
  });
}

function ouvrageInput(quoteId: string, extra: Record<string, unknown> = {}) {
  return quotesMutationSchema.parse({
    action: "upsertOuvrage",
    quoteId,
    description: "Meuble bas 2 portes",
    unit: "u",
    quantityInput: "2",
    components: [
      {
        description: "Panneau mélaminé",
        unit: "m²",
        quantityInput: "2+1",
        unitPriceCents: 5_000,
      },
      {
        description: "Heure atelier",
        unit: "h",
        quantityInput: "3",
        unitPriceCents: 7_000,
      },
    ],
    ...extra,
  });
}

describe("native quote ouvrage editor", () => {
  it("adds an ouvrage composed of several components and derives its unit price", () => {
    const created = draft();
    const result = applyQuotesMutation(created.payload, ouvrageInput(created.focusQuoteId), actor);
    const line = result.payload.quotes[0].model.items[0];

    expect(line).toMatchObject({
      kind: "LINE",
      parentId: null,
      description: "Meuble bas 2 portes",
      unit: "u",
      quantity: 2,
      quantityFormula: null,
      unitPriceCents: 36_000,
    });
    if (line.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");
    expect(line.components).toHaveLength(2);
    expect(line.components?.[0]).toMatchObject({
      description: "Panneau mélaminé",
      unit: "m²",
      quantity: 3,
      quantityFormula: "2+1",
      unitPriceCents: 5_000,
    });
    expect(line.components?.[1]).toMatchObject({
      description: "Heure atelier",
      quantity: 3,
      unitPriceCents: 7_000,
    });
  });

  it("edits an ouvrage without duplicating it and preserves component ids", () => {
    const created = draft();
    const added = applyQuotesMutation(created.payload, ouvrageInput(created.focusQuoteId), actor);
    const firstLine = added.payload.quotes[0].model.items[0];
    if (firstLine.kind !== "LINE" || !firstLine.components) throw new Error("TEST_LINE_NOT_FOUND");

    const firstComponentId = firstLine.components[0].id;
    const updated = applyQuotesMutation(
      added.payload,
      ouvrageInput(created.focusQuoteId, {
        lineId: firstLine.id,
        description: "Meuble bas 3 portes",
        components: [
          {
            id: firstComponentId,
            description: "Panneau mélaminé",
            unit: "m²",
            quantityInput: "4",
            unitPriceCents: 5_000,
          },
        ],
      }),
      actor,
    );

    expect(updated.payload.quotes[0].model.items).toHaveLength(1);
    const updatedLine = updated.payload.quotes[0].model.items[0];
    expect(updatedLine).toMatchObject({
      id: firstLine.id,
      description: "Meuble bas 3 portes",
      unitPriceCents: 20_000,
    });
    if (updatedLine.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");
    expect(updatedLine.components).toHaveLength(1);
    expect(updatedLine.components?.[0].id).toBe(firstComponentId);
  });

  it("keeps the former flat-line mutation readable for existing data and integrations", () => {
    const created = draft();
    const result = applyQuotesMutation(created.payload, lineInput(created.focusQuoteId), actor);

    expect(result.payload.quotes[0].model.items[0]).toMatchObject({
      kind: "LINE",
      parentId: null,
      description: "Caisson mélaminé",
      unit: "u",
      quantity: 5,
      quantityFormula: "2+3",
      unitPriceCents: 25_000,
      components: [],
    });
  });

  it("creates a library component snapshot from legacy flat-line pricing", () => {
    const linked = createLibraryComponentFromQuoteLine({
      componentId: "44444444-4444-4444-8444-444444444444",
      name: "Caisson standard",
      description: "Caisson mélaminé",
      unit: "u",
      costPriceCents: 10_000,
      salePriceCents: 15_000,
    });

    expect(linked.component.marginPercent).toBe(50);
    expect(linked.source).toMatchObject({
      kind: "COMPONENT",
      component: {
        sourceComponentId: "44444444-4444-4444-8444-444444444444",
        salePriceCents: 15_000,
      },
    });
  });

  it("keeps the library snapshot on a legacy stored quote line", () => {
    const created = draft();
    const linked = createLibraryComponentFromQuoteLine({
      componentId: "44444444-4444-4444-8444-444444444444",
      name: "Caisson standard",
      description: "Caisson mélaminé",
      unit: "u",
      costPriceCents: 10_000,
      salePriceCents: 25_000,
    });
    const result = applyQuotesMutation(
      created.payload,
      lineInput(created.focusQuoteId),
      actor,
      undefined,
      new Date(),
      linked.source,
    );

    expect(result.payload.quotes[0].model.items[0]).toMatchObject({
      librarySource: {
        kind: "COMPONENT",
        component: { sourceComponentId: "44444444-4444-4444-8444-444444444444" },
      },
    });
  });
});
