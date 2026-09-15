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
      quantityInput: "2",
      forcedUnitPriceCents: 24000,
      components: [
        {
          description: `Composant ${description}`,
          unit: "u",
          quantityInput: "3",
          costPriceCents: 5000,
          unitPriceCents: 8000,
        },
      ],
    }),
    actor,
  );
}

function label(
  item: ReturnType<typeof createDraft>["payload"]["quotes"][number]["model"]["items"][number],
) {
  return item.kind === "LINE" ? item.description : item.kind === "COMMENT" ? item.text : item.title;
}

describe("quote heading duplication", () => {
  it("duplicates a grand title with subsections, ouvrages and fresh ids", () => {
    const created = createDraft();
    const sectionResult = addSection(created.payload, created.focusQuoteId, "Mobilier");
    const section = sectionResult.payload.quotes[0].model.items[0];
    if (section.kind !== "SECTION") throw new Error("TEST_SECTION");
    const subsectionResult = addSubsection(
      sectionResult.payload,
      created.focusQuoteId,
      section.id,
      "Accueil",
    );
    const subsection = subsectionResult.payload.quotes[0].model.items[1];
    if (subsection.kind !== "SUBSECTION") throw new Error("TEST_SUBSECTION");
    const ouvrageResult = addOuvrage(
      subsectionResult.payload,
      created.focusQuoteId,
      subsection.id,
      "Meuble bas",
    );
    const sourceLine = ouvrageResult.payload.quotes[0].model.items[2];
    if (sourceLine.kind !== "LINE" || !sourceLine.components?.[0]) throw new Error("TEST_LINE");

    const duplicated = applyQuotesMutation(
      ouvrageResult.payload,
      quotesMutationSchema.parse({
        action: "duplicateHeading",
        quoteId: created.focusQuoteId,
        itemId: section.id,
      }),
      actor,
      undefined,
      new Date("2026-09-15T12:30:00.000Z"),
    );

    const items = duplicated.payload.quotes[0].model.items;
    expect(items.map(label)).toEqual([
      "Mobilier",
      "Accueil",
      "Meuble bas",
      "Mobilier",
      "Accueil",
      "Meuble bas",
    ]);
    const copiedSection = items[3];
    const copiedSubsection = items[4];
    const copiedLine = items[5];
    if (copiedSection.kind !== "SECTION") throw new Error("TEST_COPY_SECTION");
    if (copiedSubsection.kind !== "SUBSECTION") throw new Error("TEST_COPY_SUBSECTION");
    if (copiedLine.kind !== "LINE" || !copiedLine.components?.[0])
      throw new Error("TEST_COPY_LINE");

    expect(copiedSection.id).not.toBe(section.id);
    expect(copiedSubsection.id).not.toBe(subsection.id);
    expect(copiedSubsection.parentId).toBe(copiedSection.id);
    expect(copiedLine.id).not.toBe(sourceLine.id);
    expect(copiedLine.parentId).toBe(copiedSubsection.id);
    expect(copiedLine.components[0].id).not.toBe(sourceLine.components[0].id);
    expect(copiedLine).toMatchObject({
      description: sourceLine.description,
      quantity: sourceLine.quantity,
      unitPriceCents: sourceLine.unitPriceCents,
      forcedUnitPriceCents: sourceLine.forcedUnitPriceCents,
    });
    expect(duplicated.payload.quotes[0].updatedAt).toBe("2026-09-15T12:30:00.000Z");
  });

  it("duplicates a subsection with its ouvrages inside the same grand title", () => {
    const created = createDraft();
    const sectionResult = addSection(created.payload, created.focusQuoteId, "Mobilier");
    const section = sectionResult.payload.quotes[0].model.items[0];
    if (section.kind !== "SECTION") throw new Error("TEST_SECTION");
    const subsectionResult = addSubsection(
      sectionResult.payload,
      created.focusQuoteId,
      section.id,
      "Banque accueil",
    );
    const subsection = subsectionResult.payload.quotes[0].model.items[1];
    if (subsection.kind !== "SUBSECTION") throw new Error("TEST_SUBSECTION");
    const ouvrageResult = addOuvrage(
      subsectionResult.payload,
      created.focusQuoteId,
      subsection.id,
      "Façade",
    );

    const duplicated = applyQuotesMutation(
      ouvrageResult.payload,
      quotesMutationSchema.parse({
        action: "duplicateHeading",
        quoteId: created.focusQuoteId,
        itemId: subsection.id,
      }),
      actor,
    );

    const items = duplicated.payload.quotes[0].model.items;
    expect(items.map(label)).toEqual([
      "Mobilier",
      "Banque accueil",
      "Façade",
      "Banque accueil",
      "Façade",
    ]);
    const copiedSubsection = items[3];
    const copiedLine = items[4];
    if (copiedSubsection.kind !== "SUBSECTION" || copiedLine.kind !== "LINE")
      throw new Error("TEST_COPY");
    expect(copiedSubsection.parentId).toBe(section.id);
    expect(copiedLine.parentId).toBe(copiedSubsection.id);
  });

  it("refuses duplication outside a draft or for a non-heading item", () => {
    const created = createDraft();
    const sectionResult = addSection(created.payload, created.focusQuoteId, "Titre");
    const section = sectionResult.payload.quotes[0].model.items[0];
    if (section.kind !== "SECTION") throw new Error("TEST_SECTION");
    const lineResult = addOuvrage(
      sectionResult.payload,
      created.focusQuoteId,
      section.id,
      "Ouvrage",
    );
    const line = lineResult.payload.quotes[0].model.items[1];
    if (line.kind !== "LINE") throw new Error("TEST_LINE");

    expect(() =>
      applyQuotesMutation(
        lineResult.payload,
        quotesMutationSchema.parse({
          action: "duplicateHeading",
          quoteId: created.focusQuoteId,
          itemId: line.id,
        }),
        actor,
      ),
    ).toThrow("QUOTE_HEADING_NOT_FOUND");

    const sent = structuredClone(lineResult.payload);
    sent.quotes[0].status = "SENT";
    expect(() =>
      applyQuotesMutation(
        sent,
        quotesMutationSchema.parse({
          action: "duplicateHeading",
          quoteId: created.focusQuoteId,
          itemId: section.id,
        }),
        actor,
      ),
    ).toThrow("QUOTE_NOT_EDITABLE");
  });
});
