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

function addOuvrage(
  payload: ReturnType<typeof createDraft>["payload"],
  quoteId: string,
  parentId: string,
  description: string,
) {
  return applyQuotesMutation(
    payload,
    quotesMutationSchema.parse({
      action: "upsertOuvrage",
      quoteId,
      parentId,
      description,
      unit: "u",
      quantityInput: "1",
      components: [
        {
          description: `Composant ${description}`,
          unit: "u",
          quantityInput: "1",
          costPriceCents: 1000,
          unitPriceCents: 1500,
        },
      ],
    }),
    actor,
  );
}

describe("quote line reorder", () => {
  it("moves an ouvrage up and down only inside its contiguous parent block", () => {
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

    const one = addOuvrage(withSection.payload, created.focusQuoteId, section.id, "Ouvrage A");
    const two = addOuvrage(one.payload, created.focusQuoteId, section.id, "Ouvrage B");
    const three = addOuvrage(two.payload, created.focusQuoteId, section.id, "Ouvrage C");
    const source = three.payload.quotes[0].model.items[2];
    if (source.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");

    const movedUp = applyQuotesMutation(
      three.payload,
      quotesMutationSchema.parse({
        action: "moveLine",
        quoteId: created.focusQuoteId,
        lineId: source.id,
        direction: "UP",
      }),
      actor,
      undefined,
      new Date("2026-09-15T12:10:00.000Z"),
    );

    expect(
      movedUp.payload.quotes[0].model.items
        .filter((item) => item.kind === "LINE")
        .map((item) => (item.kind === "LINE" ? item.description : "")),
    ).toEqual(["Ouvrage B", "Ouvrage A", "Ouvrage C"]);
    expect(movedUp.payload.quotes[0].updatedAt).toBe("2026-09-15T12:10:00.000Z");

    const movedDown = applyQuotesMutation(
      movedUp.payload,
      quotesMutationSchema.parse({
        action: "moveLine",
        quoteId: created.focusQuoteId,
        lineId: source.id,
        direction: "DOWN",
      }),
      actor,
    );
    expect(
      movedDown.payload.quotes[0].model.items
        .filter((item) => item.kind === "LINE")
        .map((item) => (item.kind === "LINE" ? item.description : "")),
    ).toEqual(["Ouvrage A", "Ouvrage B", "Ouvrage C"]);
  });

  it("does not move an ouvrage through a title boundary", () => {
    const created = createDraft();
    const withSection = applyQuotesMutation(
      created.payload,
      quotesMutationSchema.parse({
        action: "upsertSection",
        quoteId: created.focusQuoteId,
        title: "Bloc A",
      }),
      actor,
    );
    const firstSection = withSection.payload.quotes[0].model.items[0];
    if (firstSection.kind !== "SECTION") throw new Error("TEST_SECTION_NOT_FOUND");
    const withLine = addOuvrage(
      withSection.payload,
      created.focusQuoteId,
      firstSection.id,
      "Ouvrage A",
    );
    const withSecondSection = applyQuotesMutation(
      withLine.payload,
      quotesMutationSchema.parse({
        action: "upsertSection",
        quoteId: created.focusQuoteId,
        title: "Bloc B",
      }),
      actor,
    );
    const line = withSecondSection.payload.quotes[0].model.items[1];
    if (line.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");

    expect(() =>
      applyQuotesMutation(
        withSecondSection.payload,
        quotesMutationSchema.parse({
          action: "moveLine",
          quoteId: created.focusQuoteId,
          lineId: line.id,
          direction: "DOWN",
        }),
        actor,
      ),
    ).toThrow("QUOTE_LINE_MOVE_BLOCKED");
  });

  it("refuses reordering outside a draft", () => {
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
    const one = addOuvrage(withSection.payload, created.focusQuoteId, section.id, "Ouvrage A");
    const two = addOuvrage(one.payload, created.focusQuoteId, section.id, "Ouvrage B");
    const line = two.payload.quotes[0].model.items[2];
    if (line.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");
    const sent = structuredClone(two.payload);
    sent.quotes[0].status = "SENT";

    expect(() =>
      applyQuotesMutation(
        sent,
        quotesMutationSchema.parse({
          action: "moveLine",
          quoteId: created.focusQuoteId,
          lineId: line.id,
          direction: "UP",
        }),
        actor,
      ),
    ).toThrow("QUOTE_NOT_EDITABLE");
  });
});
