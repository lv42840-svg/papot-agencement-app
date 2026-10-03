import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/components/quote-structured-lines-editor.tsx", import.meta.url),
  "utf-8",
);

describe("quote adjusted line totals UI", () => {
  it("uses the adjusted pricing engine for each displayed ouvrage total", () => {
    expect(source).toContain("calculateQuoteAdjustedPricing");
    expect(source).toContain("adjustedLinesById");
    expect(source).toContain("adjustedLine?.saleCents ?? baseLineTotalCents");
    expect(source).toContain("d’ajustements");
  });
});
