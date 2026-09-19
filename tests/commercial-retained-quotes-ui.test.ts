import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(
  new URL("../src/components/commercial-workspace-v2.tsx", import.meta.url),
  "utf-8",
);
const dialog = readFileSync(
  new URL("../src/components/commercial-confirmation-dialog.tsx", import.meta.url),
  "utf-8",
);
const affairQuotes = readFileSync(
  new URL("../src/components/commercial-affair-quotes.tsx", import.meta.url),
  "utf-8",
);

describe("commercial retained quote confirmation UI", () => {
  it("routes both confirmation paths through the quote selection dialog", () => {
    expect(workspace).toContain("<CommercialConfirmationDialog");
    expect(workspace).toContain('action: "setStatus"');
    expect(workspace).toContain('action: "recordFollowUp"');
    expect(workspace).toContain("retainedQuoteIds");
    expect(workspace).toContain("confirmWithoutQuote");
  });

  it("supports multiple retained quotes and keeps drafts visible but disabled", () => {
    expect(dialog).toContain('type="checkbox"');
    expect(dialog).toContain("quoteCanBeRetained");
    expect(dialog).toContain("Brouillon non figé");
    expect(dialog).toContain("Tu peux en retenir plusieurs");
    expect(dialog).toContain("Confirmer explicitement l’affaire sans devis retenu");
  });

  it("shows the contractual cumulative metrics after confirmation", () => {
    expect(affairQuotes).toContain("Cumul contractuel des devis retenus");
    expect(affairQuotes).toContain("CA HT vendu");
    expect(affairQuotes).toContain("Heures vendues");
    expect(affairQuotes).toContain("Déboursé prévu");
    expect(affairQuotes).toContain("Marge prévue");
    expect(affairQuotes).toContain("Retenu / accepté");
    expect(affairQuotes).toContain("Non retenu / classé");
  });
});
