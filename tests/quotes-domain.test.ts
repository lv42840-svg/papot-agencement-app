import { describe, expect, it } from "vitest";
import {
  applySequentialQuoteDiscounts,
  calculateQuoteLine,
  formatQuoteNumber,
  parseQuoteQuantityInput,
  percentageAmountCents,
  quoteValidityDate,
} from "../src/lib/quotes/domain";
import { parseQuoteModel } from "../src/lib/quotes/model";

describe("native quote quantity expressions", () => {
  it("keeps a plain quantity without a formula memo", () => {
    expect(parseQuoteQuantityInput("3.5")).toEqual({ quantity: 3.5, formula: null });
    expect(parseQuoteQuantityInput("3,5")).toEqual({ quantity: 3.5, formula: null });
  });

  it("evaluates and keeps an addition formula", () => {
    expect(parseQuoteQuantityInput("2+6+4+9")).toEqual({
      quantity: 21,
      formula: "2+6+4+9",
    });
  });

  it("respects multiplication priority", () => {
    expect(parseQuoteQuantityInput("2+4*3")).toEqual({ quantity: 14, formula: "2+4*3" });
  });

  it("supports parentheses and decimal commas", () => {
    expect(parseQuoteQuantityInput("(2,5 + 1,5) * 2")).toEqual({
      quantity: 8,
      formula: "(2,5 + 1,5) * 2",
    });
  });

  it("supports division", () => {
    expect(parseQuoteQuantityInput("7/2")).toEqual({ quantity: 3.5, formula: "7/2" });
  });

  it("rounds quantity calculations to six decimals", () => {
    expect(parseQuoteQuantityInput("1/3")).toEqual({ quantity: 0.333333, formula: "1/3" });
  });

  it("rejects unsafe or malformed formulas", () => {
    expect(() => parseQuoteQuantityInput("alert(1)")).toThrow("QUOTE_QUANTITY_EXPRESSION_INVALID");
    expect(() => parseQuoteQuantityInput("2++")).toThrow("QUOTE_QUANTITY_EXPRESSION_INVALID");
    expect(() => parseQuoteQuantityInput("2/0")).toThrow("QUOTE_QUANTITY_DIVISION_BY_ZERO");
  });

  it("rejects zero and negative resulting quantities", () => {
    expect(() => parseQuoteQuantityInput("2-2")).toThrow("QUOTE_QUANTITY_INVALID");
    expect(() => parseQuoteQuantityInput("2-5")).toThrow("QUOTE_QUANTITY_INVALID");
  });
});

describe("native quote numbering and validity", () => {
  it("formats the frozen company quote number", () => {
    expect(formatQuoteNumber(2026, 1)).toBe("D-2026-0001");
    expect(formatQuoteNumber(2026, 865)).toBe("D-2026-0865");
  });

  it("rejects an invalid sequence", () => {
    expect(() => formatQuoteNumber(2026, 0)).toThrow("QUOTE_SEQUENCE_INVALID");
    expect(() => formatQuoteNumber(2026, 10_000)).toThrow("QUOTE_SEQUENCE_INVALID");
  });

  it("uses 30 calendar days by default", () => {
    expect(quoteValidityDate("2026-09-13")).toBe("2026-10-13");
  });

  it("handles month and leap-year boundaries", () => {
    expect(quoteValidityDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(quoteValidityDate("2028-02-28", 2)).toBe("2028-03-01");
  });
});

describe("native quote money calculations", () => {
  it("stores percentage amounts in financial cents", () => {
    expect(percentageAmountCents(12_345, 10)).toBe(1_235);
  });

  it("calculates a line with quantity, discount, VAT and TTC", () => {
    expect(
      calculateQuoteLine({
        quantity: 2.5,
        unitPriceCents: 10_000,
        discountPercent: 10,
        vatRatePercent: 20,
      }),
    ).toEqual({
      grossHtCents: 25_000,
      discountPercent: 10,
      discountAmountCents: 2_500,
      netHtCents: 22_500,
      vatRatePercent: 20,
      vatAmountCents: 4_500,
      ttcCents: 27_000,
    });
  });

  it("supports zero VAT", () => {
    expect(
      calculateQuoteLine({ quantity: 1, unitPriceCents: 9_999, vatRatePercent: 0 }),
    ).toMatchObject({ netHtCents: 9_999, vatAmountCents: 0, ttcCents: 9_999 });
  });

  it("applies discounts sequentially line, section, then global", () => {
    expect(
      applySequentialQuoteDiscounts(100_000, [
        { kind: "LINE", percent: 10 },
        { kind: "SECTION", percent: 10 },
        { kind: "GLOBAL", percent: 10 },
      ]),
    ).toEqual({
      finalCents: 72_900,
      steps: [
        { kind: "LINE", percent: 10, amountCents: 10_000, remainingCents: 90_000 },
        { kind: "SECTION", percent: 10, amountCents: 9_000, remainingCents: 81_000 },
        { kind: "GLOBAL", percent: 10, amountCents: 8_100, remainingCents: 72_900 },
      ],
    });
  });

  it("rejects invalid percentages and money", () => {
    expect(() => percentageAmountCents(-1, 10)).toThrow("QUOTE_MONEY_INVALID");
    expect(() => percentageAmountCents(100, 101)).toThrow("QUOTE_PERCENT_INVALID");
  });
});

const sectionId = "11111111-1111-4111-8111-111111111111";
const subsectionId = "22222222-2222-4222-8222-222222222222";
const lineId = "33333333-3333-4333-8333-333333333333";
const commentId = "44444444-4444-4444-8444-444444444444";

type TestQuote = {
  id: string;
  clientId: string;
  subject: string;
  issueDate: string;
  validityDays: number;
  paymentTerms: string;
  items: Array<Record<string, unknown>>;
};

function minimalQuote(): TestQuote {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    subject: "Agencement accueil",
    issueDate: "2026-09-13",
    validityDays: 30,
    paymentTerms: "45 jours fin de mois",
    items: [
      { id: sectionId, kind: "SECTION", parentId: null, title: "Mobilier" },
      {
        id: subsectionId,
        kind: "SUBSECTION",
        parentId: sectionId,
        title: "Meubles bas",
      },
      {
        id: lineId,
        kind: "LINE",
        parentId: subsectionId,
        description: "Caisson mélaminé",
        unit: "u",
        quantity: 21,
        quantityFormula: "2+6+4+9",
      },
      {
        id: commentId,
        kind: "COMMENT",
        parentId: sectionId,
        text: "Coloris à confirmer avec le client.",
      },
    ],
  };
}

describe("minimal native quote model", () => {
  it("accepts sections, subsections, lines and comments", () => {
    expect(parseQuoteModel(minimalQuote())).toEqual(minimalQuote());
  });

  it("keeps the quote-owned header fields", () => {
    const quote = parseQuoteModel(minimalQuote());
    expect(quote.clientId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(quote.subject).toBe("Agencement accueil");
    expect(quote.issueDate).toBe("2026-09-13");
    expect(quote.validityDays).toBe(30);
    expect(quote.paymentTerms).toBe("45 jours fin de mois");
  });

  it("allows a free line or comment outside sections", () => {
    const quote = minimalQuote();
    quote.items = [
      { ...quote.items[2], parentId: null },
      { ...quote.items[3], parentId: null },
    ];
    expect(parseQuoteModel(quote).items).toHaveLength(2);
  });

  it("rejects a subsection without a section parent", () => {
    const quote = minimalQuote();
    quote.items[1] = { ...quote.items[1], parentId: lineId };
    expect(() => parseQuoteModel(quote)).toThrow("QUOTE_ITEM_PARENT_INVALID");
  });

  it("rejects missing parents and duplicate item ids", () => {
    const missingParent = minimalQuote();
    missingParent.items[2] = {
      ...missingParent.items[2],
      parentId: "99999999-9999-4999-8999-999999999999",
    };
    expect(() => parseQuoteModel(missingParent)).toThrow("QUOTE_ITEM_PARENT_NOT_FOUND");

    const duplicate = minimalQuote();
    duplicate.items.push({ ...duplicate.items[2] });
    expect(() => parseQuoteModel(duplicate)).toThrow("QUOTE_ITEM_ID_DUPLICATE");
  });

  it("rejects an invalid calendar date", () => {
    const quote = minimalQuote();
    quote.issueDate = "2026-02-31";
    expect(() => parseQuoteModel(quote)).toThrow("QUOTE_MODEL_INVALID");
  });

  it("requires payment terms and a positive validity duration", () => {
    const missingTerms = minimalQuote();
    missingTerms.paymentTerms = "";
    expect(() => parseQuoteModel(missingTerms)).toThrow("QUOTE_MODEL_INVALID");

    const invalidValidity = minimalQuote();
    invalidValidity.validityDays = 0;
    expect(() => parseQuoteModel(invalidValidity)).toThrow("QUOTE_MODEL_INVALID");
  });

  it("keeps a quantity formula only when it explains the stored quantity", () => {
    expect(parseQuoteModel(minimalQuote()).items[2]).toMatchObject({
      quantity: 21,
      quantityFormula: "2+6+4+9",
    });

    const mismatch = minimalQuote();
    mismatch.items[2] = { ...mismatch.items[2], quantity: 20 };
    expect(() => parseQuoteModel(mismatch)).toThrow("QUOTE_LINE_FORMULA_MISMATCH");
  });

  it("rejects a plain number used as a fake formula memo", () => {
    const quote = minimalQuote();
    quote.items[2] = { ...quote.items[2], quantity: 21, quantityFormula: "21" };
    expect(() => parseQuoteModel(quote)).toThrow("QUOTE_LINE_FORMULA_INVALID");
  });
});
