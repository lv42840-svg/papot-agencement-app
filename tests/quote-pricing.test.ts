import { describe, expect, it } from "vitest";
import {
  calculateQuoteMarginFromSalePrice,
  calculateQuoteSalePriceFromMarginCents,
  parseQuoteMarginInput,
  quoteMarginToInput,
} from "../src/lib/quotes/pricing";

describe("quote pricing", () => {
  it("calculates sale price from a margin percentage", () => {
    expect(calculateQuoteSalePriceFromMarginCents(10_000, 30)).toBe(13_000);
    expect(calculateQuoteSalePriceFromMarginCents(10_000, -10)).toBe(9_000);
  });

  it("calculates margin percentage from sale price", () => {
    expect(calculateQuoteMarginFromSalePrice(10_000, 13_000)).toBe(30);
    expect(calculateQuoteMarginFromSalePrice(10_000, 9_000)).toBe(-10);
  });

  it("keeps zero-cost pricing explicit instead of inventing a percentage", () => {
    expect(calculateQuoteMarginFromSalePrice(0, 0)).toBe(0);
    expect(calculateQuoteMarginFromSalePrice(0, 1_000)).toBeNull();
  });

  it("accepts french decimal margin input and formats it for the editor", () => {
    expect(parseQuoteMarginInput("30,5")).toBe(30.5);
    expect(quoteMarginToInput(66.666666)).toBe("66,67");
  });

  it("rejects a margin below -100 percent", () => {
    expect(() => calculateQuoteSalePriceFromMarginCents(10_000, -100.01)).toThrow(
      "QUOTE_PRICING_MARGIN_INVALID",
    );
  });
});
