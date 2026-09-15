import { describe, expect, it } from "vitest";
import { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";
import type { QuoteLibraryComponentSource } from "../src/lib/quotes/model";
import { createInitialNativeQuotesPayload } from "../src/lib/quotes/store";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};
const affairId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const libraryComponentId = "44444444-4444-4444-8444-444444444444";

function draft() {
  return applyQuotesMutation(
    createInitialNativeQuotesPayload(),
    quotesMutationSchema.parse({
      action: "createDraft",
      commercialCaseId: affairId,
      subject: "Agencement accueil",
      issueDate: "2026-09-15",
      paymentTerms: "45 jours fin de mois",
    }),
    actor,
    clientId,
  );
}

const source: QuoteLibraryComponentSource = {
  schemaVersion: 1,
  kind: "COMPONENT",
  component: {
    sourceComponentId: libraryComponentId,
    name: "Panneau mélaminé blanc",
    description: "Panneau décor blanc 19 mm.",
    unit: "m²",
    costPriceCents: 4_000,
    marginPercent: 30,
    salePriceCents: 5_200,
  },
};

describe("quote component selected from Library", () => {
  it("keeps the Library snapshot on the new ouvrage component", () => {
    const created = draft();
    const input = quotesMutationSchema.parse({
      action: "upsertOuvrage",
      quoteId: created.focusQuoteId,
      description: "Meuble bas",
      unit: "u",
      quantityInput: "1",
      components: [
        {
          libraryComponentId,
          description: "Panneau mélaminé blanc",
          unit: "m²",
          quantityInput: "2",
          costPriceCents: 4_000,
          unitPriceCents: 5_200,
        },
      ],
    });

    const result = applyQuotesMutation(
      created.payload,
      input,
      actor,
      undefined,
      new Date("2026-09-15T10:00:00.000Z"),
      undefined,
      new Map([[libraryComponentId, source]]),
    );
    const line = result.payload.quotes[0].model.items[0];
    if (line.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");

    expect(line.components?.[0]).toMatchObject({
      description: "Panneau mélaminé blanc",
      costPriceCents: 4_000,
      unitPriceCents: 5_200,
      librarySource: {
        kind: "COMPONENT",
        component: { sourceComponentId: libraryComponentId },
      },
    });
  });

  it("rejects an unresolved Library component id", () => {
    const created = draft();
    const input = quotesMutationSchema.parse({
      action: "upsertOuvrage",
      quoteId: created.focusQuoteId,
      description: "Meuble bas",
      unit: "u",
      quantityInput: "1",
      components: [
        {
          libraryComponentId,
          description: "Panneau mélaminé blanc",
          unit: "m²",
          quantityInput: "1",
          unitPriceCents: 5_200,
        },
      ],
    });

    expect(() => applyQuotesMutation(created.payload, input, actor)).toThrow(
      "QUOTE_LIBRARY_COMPONENT_NOT_FOUND",
    );
  });
});
