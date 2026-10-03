import { describe, expect, it } from "vitest";
import { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";
import { createInitialNativeQuotesPayload } from "../src/lib/quotes/store";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};
const affairId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";

function createDraft() {
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
    new Date("2026-09-15T12:00:00.000Z"),
  );
}

function addOuvrageWithSection() {
  const created = createDraft();
  const withSection = applyQuotesMutation(
    created.payload,
    quotesMutationSchema.parse({
      action: "upsertSection",
      quoteId: created.focusQuoteId,
      title: "Mobilier",
    }),
    actor,
  );
  const section = withSection.payload.quotes[0].model.items[0];
  if (section.kind !== "SECTION") throw new Error("TEST_SECTION_NOT_FOUND");

  return applyQuotesMutation(
    withSection.payload,
    quotesMutationSchema.parse({
      action: "upsertOuvrage",
      quoteId: created.focusQuoteId,
      parentId: section.id,
      description: "Meuble bas 2 portes",
      unit: "u",
      quantityInput: "2",
      forcedUnitPriceCents: 40_000,
      components: [
        {
          description: "Panneau mélaminé",
          unit: "m²",
          quantityInput: "3",
          costPriceCents: 3_000,
          unitPriceCents: 5_000,
        },
        {
          description: "Heure atelier",
          unit: "h",
          quantityInput: "2",
          costPriceCents: 5_000,
          unitPriceCents: 7_000,
        },
      ],
    }),
    actor,
  );
}

describe("quote line duplication", () => {
  it("duplicates an ouvrage immediately after its source with fresh ids", () => {
    const added = addOuvrageWithSection();
    const source = added.payload.quotes[0].model.items[1];
    if (source.kind !== "LINE" || !source.components) throw new Error("TEST_LINE_NOT_FOUND");

    const duplicated = applyQuotesMutation(
      added.payload,
      quotesMutationSchema.parse({
        action: "duplicateLine",
        quoteId: added.focusQuoteId,
        lineId: source.id,
      }),
      actor,
      undefined,
      new Date("2026-09-15T12:05:00.000Z"),
    );

    const items = duplicated.payload.quotes[0].model.items;
    expect(items).toHaveLength(3);
    expect(items[1].id).toBe(source.id);
    const copy = items[2];
    expect(copy.kind).toBe("LINE");
    if (copy.kind !== "LINE" || !copy.components) throw new Error("TEST_COPY_NOT_FOUND");

    expect(copy.id).not.toBe(source.id);
    expect(copy).toMatchObject({
      parentId: source.parentId,
      description: source.description,
      unit: source.unit,
      quantity: source.quantity,
      quantityFormula: source.quantityFormula,
      unitPriceCents: source.unitPriceCents,
      forcedUnitPriceCents: source.forcedUnitPriceCents,
    });
    expect(copy.components).toHaveLength(source.components.length);
    copy.components.forEach((component, index) => {
      expect(component.id).not.toBe(source.components![index].id);
      expect(component).toMatchObject({
        description: source.components![index].description,
        unit: source.components![index].unit,
        quantity: source.components![index].quantity,
        quantityFormula: source.components![index].quantityFormula,
        costPriceCents: source.components![index].costPriceCents,
        unitPriceCents: source.components![index].unitPriceCents,
      });
    });
    expect(duplicated.payload.quotes[0].updatedAt).toBe("2026-09-15T12:05:00.000Z");
  });

  it("refuses duplication outside a draft", () => {
    const added = addOuvrageWithSection();
    const source = added.payload.quotes[0].model.items[1];
    if (source.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");
    const sent = structuredClone(added.payload);
    sent.quotes[0].status = "SENT";

    expect(() =>
      applyQuotesMutation(
        sent,
        quotesMutationSchema.parse({
          action: "duplicateLine",
          quoteId: added.focusQuoteId,
          lineId: source.id,
        }),
        actor,
      ),
    ).toThrow("QUOTE_NOT_EDITABLE");
  });
});
