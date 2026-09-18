import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const operational = readFileSync(
  new URL("../src/components/chantier-operational-workspace.tsx", import.meta.url),
  "utf-8",
);
const chantierRoute = readFileSync(
  new URL("../src/app/api/desktop/chantiers/route.ts", import.meta.url),
  "utf-8",
);
const launchWorkspace = readFileSync(
  new URL("../src/components/chantiers-workspace.tsx", import.meta.url),
  "utf-8",
);

describe("chantier quote and TS UI bridge", () => {
  it("uses native quote structures instead of reparsing Obat PDFs", () => {
    expect(operational).toContain("retainedChantierQuotes");
    expect(operational).toContain("retainedChantierQuoteLines");
    expect(operational).not.toContain("requestObatAnalysis");
    expect(operational).not.toContain("ObatQuoteLine");
    expect(operational).not.toContain("Lecture automatique des lignes des devis OBAT");
  });

  it("persists durable quote-line and TS identifiers", () => {
    expect(operational).toContain("sourceQuoteId");
    expect(operational).toContain("sourceQuoteLineId");
    expect(operational).toContain("sourceTsId");
    expect(chantierRoute).toContain("resolveRetainedChantierQuoteLine");
    expect(chantierRoute).toContain("CHANTIER_QUOTE_LINE_REQUIRED");
    expect(chantierRoute).toContain("CHANTIER_TS_REQUIRED");
  });

  it("provides the complementary quote and unpriced TS workflow in Admin", () => {
    expect(operational).toContain("Devis complémentaires disponibles");
    expect(operational).toContain('action: "retainAdditionalQuote"');
    expect(operational).toContain("TS non chiffrés / régularisés");
    expect(operational).toContain('action: "createTs"');
    expect(operational).toContain('action: "linkTsToQuoteLine"');
  });

  it("recognizes retained native quotes on the launch sheet", () => {
    expect(launchWorkspace).toContain("item.retainedQuoteIds.length > 0");
  });
});
