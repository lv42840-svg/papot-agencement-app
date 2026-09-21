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

function addSection(
  payload: ReturnType<typeof createDraft>["payload"],
  quoteId: string,
  title: string,
) {
  return applyQuotesMutation(
    payload,
    quotesMutationSchema.parse({ action: "upsertSection", quoteId, title }),
    actor,
  );
}

function addSubsection(
  payload: ReturnType<typeof createDraft>["payload"],
  quoteId: string,
  parentId: string,
  title: string,
) {
  return applyQuotesMutation(
    payload,
    quotesMutationSchema.parse({ action: "upsertSubsection", quoteId, parentId, title }),
    actor,
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

describe("quote heading reorder", () => {
  it("moves a grand title with all of its nested content", () => {
    const created = createDraft();
    const a = addSection(created.payload, created.focusQuoteId, "Titre A");
    const sectionA = a.payload.quotes[0].model.items[0];
    if (sectionA.kind !== "SECTION") throw new Error("TEST_SECTION_A");
    const aSub = addSubsection(a.payload, created.focusQuoteId, sectionA.id, "Sous A");
    const subsectionA = aSub.payload.quotes[0].model.items[1];
    if (subsectionA.kind !== "SUBSECTION") throw new Error("TEST_SUBSECTION_A");
    const aLine = addOuvrage(aSub.payload, created.focusQuoteId, subsectionA.id, "Ouvrage A");
    const b = addSection(aLine.payload, created.focusQuoteId, "Titre B");
    const sectionB = b.payload.quotes[0].model.items[3];
    if (sectionB.kind !== "SECTION") throw new Error("TEST_SECTION_B");
    const bLine = addOuvrage(b.payload, created.focusQuoteId, sectionB.id, "Ouvrage B");

    const moved = applyQuotesMutation(
      bLine.payload,
      quotesMutationSchema.parse({
        action: "moveHeading",
        quoteId: created.focusQuoteId,
        itemId: sectionB.id,
        direction: "UP",
      }),
      actor,
      undefined,
      new Date("2026-09-15T12:20:00.000Z"),
    );

    expect(
      moved.payload.quotes[0].model.items.map((item) =>
        item.kind === "LINE" ? item.description : item.kind === "COMMENT" ? item.text : item.title,
      ),
    ).toEqual(["Titre B", "Ouvrage B", "Titre A", "Sous A", "Ouvrage A"]);
    expect(moved.payload.quotes[0].model.items[1].parentId).toBe(sectionB.id);
    expect(moved.payload.quotes[0].model.items[3].parentId).toBe(sectionA.id);
    expect(moved.payload.quotes[0].model.items[4].parentId).toBe(subsectionA.id);
    expect(moved.payload.quotes[0].updatedAt).toBe("2026-09-15T12:20:00.000Z");
  });

  it("moves a subsection with its ouvrages but stays inside the same grand title", () => {
    const created = createDraft();
    const sectionResult = addSection(created.payload, created.focusQuoteId, "Titre");
    const section = sectionResult.payload.quotes[0].model.items[0];
    if (section.kind !== "SECTION") throw new Error("TEST_SECTION");
    const one = addSubsection(sectionResult.payload, created.focusQuoteId, section.id, "Sous 1");
    const subsectionOne = one.payload.quotes[0].model.items[1];
    if (subsectionOne.kind !== "SUBSECTION") throw new Error("TEST_SUB_ONE");
    const oneLine = addOuvrage(one.payload, created.focusQuoteId, subsectionOne.id, "Ouvrage 1");
    const two = addSubsection(oneLine.payload, created.focusQuoteId, section.id, "Sous 2");
    const subsectionTwo = two.payload.quotes[0].model.items[3];
    if (subsectionTwo.kind !== "SUBSECTION") throw new Error("TEST_SUB_TWO");
    const twoLine = addOuvrage(two.payload, created.focusQuoteId, subsectionTwo.id, "Ouvrage 2");

    const moved = applyQuotesMutation(
      twoLine.payload,
      quotesMutationSchema.parse({
        action: "moveHeading",
        quoteId: created.focusQuoteId,
        itemId: subsectionTwo.id,
        direction: "UP",
      }),
      actor,
    );

    expect(
      moved.payload.quotes[0].model.items.map((item) =>
        item.kind === "LINE" ? item.description : item.kind === "COMMENT" ? item.text : item.title,
      ),
    ).toEqual(["Titre", "Sous 2", "Ouvrage 2", "Sous 1", "Ouvrage 1"]);
    expect(moved.payload.quotes[0].model.items[1].parentId).toBe(section.id);
    expect(moved.payload.quotes[0].model.items[2].parentId).toBe(subsectionTwo.id);
    expect(moved.payload.quotes[0].model.items[3].parentId).toBe(section.id);
    expect(moved.payload.quotes[0].model.items[4].parentId).toBe(subsectionOne.id);
  });

  it("blocks a heading at its hierarchy boundary and outside draft status", () => {
    const created = createDraft();
    const sectionResult = addSection(created.payload, created.focusQuoteId, "Titre unique");
    const section = sectionResult.payload.quotes[0].model.items[0];
    if (section.kind !== "SECTION") throw new Error("TEST_SECTION");

    expect(() =>
      applyQuotesMutation(
        sectionResult.payload,
        quotesMutationSchema.parse({
          action: "moveHeading",
          quoteId: created.focusQuoteId,
          itemId: section.id,
          direction: "UP",
        }),
        actor,
      ),
    ).toThrow("QUOTE_HEADING_MOVE_BLOCKED");

    const sent = structuredClone(sectionResult.payload);
    sent.quotes[0].status = "SENT";
    expect(() =>
      applyQuotesMutation(
        sent,
        quotesMutationSchema.parse({
          action: "moveHeading",
          quoteId: created.focusQuoteId,
          itemId: section.id,
          direction: "DOWN",
        }),
        actor,
      ),
    ).toThrow("QUOTE_NOT_EDITABLE");
  });
});
