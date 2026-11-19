import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("éditeur de facturation organisé comme les devis", () => {
  it("affiche la navigation par ouvrages et insère une prestation dans la bonne section", () => {
    const editor = readFileSync("src/components/billing-document-editor.tsx", "utf8");
    const navigator = readFileSync("src/components/invoice-ouvrages-navigator.tsx", "utf8");
    expect(editor).toContain("<InvoiceOuvragesNavigator");
    expect(editor).toContain("invoice-document-row-");
    expect(editor).toContain('addLine("FREE", index)');
    expect(navigator).toContain("Navigation par ouvrages");
    expect(navigator).toContain("Prestation dans cet ouvrage");
  });
});
