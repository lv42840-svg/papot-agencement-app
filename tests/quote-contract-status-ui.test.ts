import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const list = readFileSync(
  new URL("../src/components/quotes-workspace.tsx", import.meta.url),
  "utf8",
);
const detail = readFileSync(
  new URL("../src/components/quote-direct-editor.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(new URL("../src/app/devis/page.tsx", import.meta.url), "utf8");
const retention = readFileSync(new URL("../src/lib/quotes/retention.ts", import.meta.url), "utf8");

describe("quote contract status UI", () => {
  it("shows document lifecycle and contract selection as two separate concepts", () => {
    expect(list).toContain("quoteDocumentStatusLabel(quote.status)");
    expect(list).toContain("quoteContractSelectionState");
    expect(list).toContain("quoteContractSelectionLabel");
    expect(retention).toContain("Retenu / contrat");
    expect(retention).toContain("Non retenu / classé");
  });

  it("feeds the retained quote ids from Commercial into the Devis workspace", () => {
    expect(page).toContain("commercialStatus: affair.status");
    expect(page).toContain("retainedQuoteIds: [...affair.retainedQuoteIds]");
  });

  it("shows the contract relationship on the quote detail without changing the quote status", () => {
    expect(detail).toContain("contractState");
    expect(detail).toContain("Ce devis entre dans le contrat de l’affaire.");
    expect(detail).toContain("Ce devis reste dans l’historique mais n’entre pas dans le contrat.");
    expect(detail).not.toContain('status: "ACCEPTED"');
    expect(detail).not.toContain('status: "REJECTED"');
  });
});
