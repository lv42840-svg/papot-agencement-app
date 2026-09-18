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
const createQuote = readFileSync(
  new URL("../src/components/quote-create-workspace.tsx", import.meta.url),
  "utf-8",
);

describe("chantier native quote and TS bridge", () => {
  it("uses native quote structures instead of reparsing Obat PDFs", () => {
    expect(operational).toContain("retainedChantierQuotes");
    expect(operational).not.toContain("requestObatAnalysis");
    expect(operational).not.toContain("ObatQuoteLine");
    expect(operational).not.toContain("Lecture automatique des lignes des devis OBAT");
  });

  it("persists durable quote-line identifiers and validates retained sources", () => {
    expect(operational).toContain("sourceQuoteId");
    expect(operational).toContain("sourceQuoteLineId");
    expect(chantierRoute).toContain("resolveRetainedChantierQuoteLine");
    expect(chantierRoute).toContain("CHANTIER_QUOTE_LINE_REQUIRED");
    expect(operational).not.toContain("sourceTsId");
    expect(chantierRoute).not.toContain("createTs");
  });

  it("creates TS through the existing native quote engine only", () => {
    expect(operational).toContain("Nouveau devis / TS");
    expect(operational).toContain("&chantier=1");
    expect(createQuote).toContain("Travaux supplémentaires (TS)");
    expect(createQuote).toContain('quoteKind === "TS"');
    expect(operational).not.toContain("TS non chiffrés / régularisés");
    expect(operational).not.toContain('action: "createTs"');
    expect(operational).not.toContain('action: "linkTsToQuoteLine"');
  });

  it("keeps full quote history and direct PDF access in chantier Admin", () => {
    expect(operational).toContain("Autres devis / historique");
    expect(operational).toContain("TS refusés");
    expect(operational).toContain("Voir le PDF");
    expect(operational).toContain('action: "retainAdditionalQuote"');
    expect(operational).toContain("Contrat initial");
  });

  it("recognizes retained native quotes on the launch sheet", () => {
    expect(launchWorkspace).toContain("item.retainedQuoteIds.length > 0");
  });
});
