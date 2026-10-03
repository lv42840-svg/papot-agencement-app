import { describe, expect, it } from "vitest";
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
      issueDate: "2026-09-15",
      paymentTerms: "45 jours fin de mois",
    }),
    actor,
    clientId,
  );
}

describe("quote headings", () => {
  it("adds a grand title, a subtitle and an ouvrage under the subtitle", () => {
    const created = draft();
    const section = applyQuotesMutation(
      created.payload,
      quotesMutationSchema.parse({
        action: "upsertSection",
        quoteId: created.focusQuoteId,
        title: "Mobilier sur mesure",
      }),
      actor,
    );
    const sectionItem = section.payload.quotes[0].model.items[0];
    expect(sectionItem).toMatchObject({ kind: "SECTION", title: "Mobilier sur mesure" });

    const subsection = applyQuotesMutation(
      section.payload,
      quotesMutationSchema.parse({
        action: "upsertSubsection",
        quoteId: created.focusQuoteId,
        parentId: sectionItem.id,
        title: "Banque accueil",
      }),
      actor,
    );
    const subsectionItem = subsection.payload.quotes[0].model.items[1];
    expect(subsectionItem).toMatchObject({
      kind: "SUBSECTION",
      parentId: sectionItem.id,
      title: "Banque accueil",
    });

    const ouvrage = applyQuotesMutation(
      subsection.payload,
      quotesMutationSchema.parse({
        action: "upsertOuvrage",
        quoteId: created.focusQuoteId,
        parentId: subsectionItem.id,
        description: "Meuble bas",
        unit: "u",
        quantityInput: "1",
        components: [
          {
            description: "Panneau",
            unit: "m²",
            quantityInput: "2",
            costPriceCents: 2000,
            unitPriceCents: 3000,
          },
        ],
      }),
      actor,
    );

    expect(ouvrage.payload.quotes[0].model.items[2]).toMatchObject({
      kind: "LINE",
      parentId: subsectionItem.id,
      description: "Meuble bas",
    });
  });

  it("edits an existing title without changing its position", () => {
    const created = draft();
    const added = applyQuotesMutation(
      created.payload,
      quotesMutationSchema.parse({
        action: "upsertSection",
        quoteId: created.focusQuoteId,
        title: "Mobilier",
      }),
      actor,
    );
    const section = added.payload.quotes[0].model.items[0];

    const edited = applyQuotesMutation(
      added.payload,
      quotesMutationSchema.parse({
        action: "upsertSection",
        quoteId: created.focusQuoteId,
        itemId: section.id,
        title: "Mobilier sur mesure",
      }),
      actor,
    );

    expect(edited.payload.quotes[0].model.items).toHaveLength(1);
    expect(edited.payload.quotes[0].model.items[0]).toMatchObject({
      id: section.id,
      kind: "SECTION",
      title: "Mobilier sur mesure",
    });
  });
});
