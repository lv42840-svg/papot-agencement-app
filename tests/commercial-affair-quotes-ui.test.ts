import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/components/commercial-affair-quotes.tsx", import.meta.url),
  "utf-8",
);

describe("commercial affair quotes UI", () => {
  it("shows the requested quote identity and economic metrics", () => {
    expect(source).toContain("Devis de l’affaire");
    expect(source).toContain("quote.finalPdf.quoteNumber");
    expect(source).toContain("quote.variantName");
    expect(source).toContain("quote.version");
    expect(source).toContain("Total HT");
    expect(source).toContain("Heures vendues");
    expect(source).toContain("Déboursé prévu");
    expect(source).toContain("calculateCommercialQuoteSummary");
  });

  it("keeps pre-signature synthesis non contractual", () => {
    expect(source).toContain("Pas de cumul contractuel à ce stade");
    expect(source).toContain("variantes et anciennes versions");
    expect(source).not.toContain("CA contractuel");
  });

  it("explains the PAPOT disbursement rule", () => {
    expect(source).toContain("Déboursé prévu = coûts prévus du devis hors heures PAPOT");
    expect(source).toContain("BE, Atelier et Pose");
  });
});
