import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/components/quote-pricing-adjustments-editor.tsx", import.meta.url),
  "utf-8",
);

describe("quote hotel adjustment UI", () => {
  it("offers hotel nights and price per night as an internal adjustment", () => {
    expect(source).toContain('<option value="HOTEL">Hôtel</option>');
    expect(source).toContain('placeholder="Nuits"');
    expect(source).toContain('placeholder="€/nuit"');
    expect(source).toContain("pricePerNightCents: parseMoneyCents(hotelPricePerNight)");
    expect(source).toContain("applyToOptions: false");
    expect(source).toContain("Le total nuits × prix est réparti au prorata des heures de pose");
  });
});
