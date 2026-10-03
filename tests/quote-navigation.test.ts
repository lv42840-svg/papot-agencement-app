import { describe, expect, it } from "vitest";
import { newQuoteHref, quoteHref } from "../src/lib/quotes/navigation";

describe("quote navigation", () => {
  it("opens a quote on its dedicated route", () => {
    expect(quoteHref("quote-123")).toBe("/devis/quote-123");
  });

  it("routes new quotes to the dedicated creation page", () => {
    expect(newQuoteHref).toBe("/devis/nouveau");
  });

  it("encodes route-unsafe ids and falls back to the quote list", () => {
    expect(quoteHref(" quote / 42 ")).toBe("/devis/quote%20%2F%2042");
    expect(quoteHref("   ")).toBe("/devis");
  });
});
