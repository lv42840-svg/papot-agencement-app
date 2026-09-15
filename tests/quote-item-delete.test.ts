import { describe, expect, it } from "vitest";
import { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";
import { createInitialNativeQuotesPayload } from "../src/lib/quotes/store";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};
const affairId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";

function mutate(payload: ReturnType<typeof createInitialNativeQuotesPayload>, input: unknown) {
  return applyQuotesMutation(payload, quotesMutationSchema.parse(input), actor);
}

function buildQuote() {
  const created = applyQuotesMutation(
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
  const quoteId = created.focusQuoteId;
  let payload = created.payload;

  payload = mutate(payload, { action: "upsertSection", quoteId, title: "Mobilier" }).payload;
  const sectionA = payload.quotes[0].model.items[0];
  if (sectionA.kind !== "SECTION") throw new Error("TEST_SECTION_A");

  payload = mutate(payload, {
    action: "upsertSubsection",
    quoteId,
    parentId: sectionA.id,
    title: "Accueil",
  }).payload;
  const subsectionA = payload.quotes[0].model.items[1];
  if (subsectionA.kind !== "SUBSECTION") throw new Error("TEST_SUBSECTION_A");

  payload = mutate(payload, {
    action: "upsertOuvrage",
    quoteId,
    parentId: subsectionA.id,
    description: "Banque accueil",
    unit: "u",
    quantityInput: "1",
    components: [
      {
        description: "Panneau",
        unit: "m2",
        quantityInput: "1",
        costPriceCents: 1000,
        unitPriceCents: 1500,
      },
    ],
  }).payload;
  const lineA = payload.quotes[0].model.items[2];
  if (lineA.kind !== "LINE") throw new Error("TEST_LINE_A");

  payload = mutate(payload, {
    action: "upsertSubsection",
    quoteId,
    parentId: sectionA.id,
    title: "Bureau",
  }).payload;
  const subsectionB = payload.quotes[0].model.items[3];
  if (subsectionB.kind !== "SUBSECTION") throw new Error("TEST_SUBSECTION_B");

  payload = mutate(payload, {
    action: "upsertOuvrage",
    quoteId,
    parentId: subsectionB.id,
    description: "Bureau direction",
    unit: "u",
    quantityInput: "1",
    components: [
      {
        description: "Panneau",
        unit: "m2",
        quantityInput: "1",
        costPriceCents: 2000,
        unitPriceCents: 3000,
      },
    ],
  }).payload;
  const lineB = payload.quotes[0].model.items[4];
  if (lineB.kind !== "LINE") throw new Error("TEST_LINE_B");

  payload = mutate(payload, { action: "upsertSection", quoteId, title: "Pose" }).payload;
  const sectionB = payload.quotes[0].model.items[5];
  if (sectionB.kind !== "SECTION") throw new Error("TEST_SECTION_B");

  payload = mutate(payload, {
    action: "upsertOuvrage",
    quoteId,
    parentId: sectionB.id,
    description: "Pose générale",
    unit: "u",
    quantityInput: "1",
    components: [
      {
        description: "Heure pose",
        unit: "h",
        quantityInput: "2",
        costPriceCents: 3000,
        unitPriceCents: 4500,
      },
    ],
  }).payload;

  return { payload, quoteId, sectionA, subsectionA, lineA, subsectionB, lineB, sectionB };
}

describe("quote item deletion", () => {
  it("deletes one ouvrage without deleting its heading", () => {
    const fixture = buildQuote();
    const result = mutate(fixture.payload, {
      action: "deleteItem",
      quoteId: fixture.quoteId,
      itemId: fixture.lineA.id,
    });
    const items = result.payload.quotes[0].model.items;
    expect(items.some((item) => item.id === fixture.lineA.id)).toBe(false);
    expect(items.some((item) => item.id === fixture.subsectionA.id)).toBe(true);
    expect(items.some((item) => item.id === fixture.lineB.id)).toBe(true);
  });

  it("deletes a subsection with its ouvrages but preserves sibling content", () => {
    const fixture = buildQuote();
    const result = mutate(fixture.payload, {
      action: "deleteItem",
      quoteId: fixture.quoteId,
      itemId: fixture.subsectionA.id,
    });
    const ids = result.payload.quotes[0].model.items.map((item) => item.id);
    expect(ids).not.toContain(fixture.subsectionA.id);
    expect(ids).not.toContain(fixture.lineA.id);
    expect(ids).toContain(fixture.sectionA.id);
    expect(ids).toContain(fixture.subsectionB.id);
    expect(ids).toContain(fixture.lineB.id);
  });

  it("deletes a title with its complete block and preserves the next title", () => {
    const fixture = buildQuote();
    const result = mutate(fixture.payload, {
      action: "deleteItem",
      quoteId: fixture.quoteId,
      itemId: fixture.sectionA.id,
    });
    const items = result.payload.quotes[0].model.items;
    expect(items.map((item) => item.id)).toEqual([fixture.sectionB.id, expect.any(String)]);
    expect(items[0]).toMatchObject({ kind: "SECTION", title: "Pose" });
    expect(items[1]).toMatchObject({ kind: "LINE", description: "Pose générale" });
  });

  it("refuses deletion outside a draft", () => {
    const fixture = buildQuote();
    const sent = structuredClone(fixture.payload);
    sent.quotes[0].status = "SENT";
    expect(() =>
      mutate(sent, { action: "deleteItem", quoteId: fixture.quoteId, itemId: fixture.lineA.id }),
    ).toThrow("QUOTE_NOT_EDITABLE");
  });
});
