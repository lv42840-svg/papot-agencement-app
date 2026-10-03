import { describe, expect, it } from "vitest";
import { reorderQuoteItems } from "../src/lib/quotes/item-reorder";
import { parseQuoteModel, type QuoteItem } from "../src/lib/quotes/model";

const sectionA = "11111111-1111-4111-8111-111111111111";
const sectionB = "22222222-2222-4222-8222-222222222222";
const subA = "33333333-3333-4333-8333-333333333333";
const subB = "44444444-4444-4444-8444-444444444444";
const lineA = "55555555-5555-4555-8555-555555555555";
const lineB = "66666666-6666-4666-8666-666666666666";

function line(id: string, parentId: string | null, description: string): QuoteItem {
  return {
    id,
    kind: "LINE",
    parentId,
    description,
    unit: "u",
    quantity: 1,
    quantityFormula: null,
    unitPriceCents: 100,
    components: [],
  };
}

function modelItems(): QuoteItem[] {
  return [
    { id: sectionA, kind: "SECTION", parentId: null, title: "A" },
    { id: subA, kind: "SUBSECTION", parentId: sectionA, title: "A.1" },
    line(lineA, subA, "Ouvrage A"),
    { id: sectionB, kind: "SECTION", parentId: null, title: "B" },
    { id: subB, kind: "SUBSECTION", parentId: sectionB, title: "B.1" },
    line(lineB, subB, "Ouvrage B"),
  ];
}

function expectValid(items: QuoteItem[]) {
  expect(() =>
    parseQuoteModel({
      id: "77777777-7777-4777-8777-777777777777",
      clientId: "88888888-8888-4888-8888-888888888888",
      subject: "Test",
      issueDate: "2026-09-15",
      validityDays: 30,
      paymentTerms: "30 jours",
      items,
    }),
  ).not.toThrow();
}

describe("quote item drag/drop reorder", () => {
  it("moves an ouvrage into another title", () => {
    const moved = reorderQuoteItems(modelItems(), lineA, sectionB, "INSIDE");
    const ouvrage = moved.find((item) => item.id === lineA);
    expect(ouvrage?.kind).toBe("LINE");
    if (ouvrage?.kind === "LINE") expect(ouvrage.parentId).toBe(sectionB);
    expect(moved.map((item) => item.id)).toEqual([sectionA, subA, sectionB, subB, lineB, lineA]);
    expectValid(moved);
  });

  it("moves an ouvrage before another ouvrage and adopts its parent", () => {
    const moved = reorderQuoteItems(modelItems(), lineA, lineB, "BEFORE");
    const ouvrage = moved.find((item) => item.id === lineA);
    if (ouvrage?.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");
    expect(ouvrage.parentId).toBe(subB);
    expect(moved.map((item) => item.id)).toEqual([sectionA, subA, sectionB, subB, lineA, lineB]);
    expectValid(moved);
  });

  it("moves a subtitle with its ouvrages into another title", () => {
    const moved = reorderQuoteItems(modelItems(), subA, sectionB, "INSIDE");
    const subtitle = moved.find((item) => item.id === subA);
    if (subtitle?.kind !== "SUBSECTION") throw new Error("TEST_SUBTITLE_NOT_FOUND");
    expect(subtitle.parentId).toBe(sectionB);
    expect(moved.map((item) => item.id)).toEqual([sectionA, sectionB, subB, lineB, subA, lineA]);
    expectValid(moved);
  });

  it("moves a whole title block after another title", () => {
    const moved = reorderQuoteItems(modelItems(), sectionA, sectionB, "AFTER");
    expect(moved.map((item) => item.id)).toEqual([sectionB, subB, lineB, sectionA, subA, lineA]);
    expectValid(moved);
  });

  it("rejects incompatible placements", () => {
    expect(() => reorderQuoteItems(modelItems(), sectionA, subB, "INSIDE")).toThrow(
      "QUOTE_ITEM_REORDER_BLOCKED",
    );
  });
});
