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
const componentId = "44444444-4444-4444-8444-444444444444";

describe("quote labor activity semantics", () => {
  it("keeps BE/Atelier/Pose activity in the Library snapshot and quote component", () => {
    const library = createLibraryComponentFromQuoteLine({
      componentId,
      name: "Heure atelier",
      description: "",
      unit: "h",
      costPriceCents: 5_000,
      salePriceCents: 7_000,
      activity: "ATELIER",
    });
    expect(library.component.activity).toBe("ATELIER");
    expect(library.source.component.activity).toBe("ATELIER");

    const draft = applyQuotesMutation(
      createInitialNativeQuotesPayload(),
      quotesMutationSchema.parse({
        action: "createDraft",
        commercialCaseId: affairId,
        subject: "Agencement",
        issueDate: "2026-09-15",
        paymentTerms: "30 jours",
      }),
      actor,
      clientId,
    );

    const saved = applyQuotesMutation(
      draft.payload,
      quotesMutationSchema.parse({
        action: "upsertOuvrage",
        quoteId: draft.focusQuoteId,
        description: "Meuble",
        unit: "u",
        quantityInput: "1",
        components: [
          {
            libraryComponentId: componentId,
            description: "Heure atelier",
            unit: "h",
            quantityInput: "3",
            unitPriceCents: 7_000,
          },
        ],
      }),
      actor,
      undefined,
      new Date(),
      undefined,
      new Map([[componentId, library.source]]),
    );

    const ouvrage = saved.payload.quotes[0].model.items[0];
    if (ouvrage.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");
    expect(ouvrage.components?.[0]).toMatchObject({
      activity: "ATELIER",
      librarySource: { component: { activity: "ATELIER" } },
    });
  });
});
