import { describe, expect, it } from "vitest";
import {
  applySequentialQuoteDiscounts,
  calculateQuoteLine,
  formatQuoteNumber,
  parseQuoteQuantityInput,
  percentageAmountCents,
  quoteValidityDate,
} from "../src/lib/quotes/domain";

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
