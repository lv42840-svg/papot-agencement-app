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

describe("native quote line editor", () => {
  it("adds a free line and keeps its quantity formula", () => {
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
    });
  });

  it("edits a line without duplicating it", () => {
    const created = draft();
    const added = applyQuotesMutation(created.payload, lineInput(created.focusQuoteId), actor);
    const firstLine = added.payload.quotes[0].model.items[0];
    const updated = applyQuotesMutation(
      added.payload,
      lineInput(created.focusQuoteId, {
        lineId: firstLine.id,
        description: "Caisson chêne",
        quantityInput: "2",
        unitPriceCents: 30_000,
      }),
      actor,
    );

    expect(updated.payload.quotes[0].model.items).toHaveLength(1);
    expect(updated.payload.quotes[0].model.items[0]).toMatchObject({
      id: firstLine.id,
      description: "Caisson chêne",
      quantity: 2,
      quantityFormula: null,
      unitPriceCents: 30_000,
    });
  });

  it("creates a library component snapshot from the line pricing", () => {
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

  it("keeps the library snapshot on the stored quote line", () => {
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
