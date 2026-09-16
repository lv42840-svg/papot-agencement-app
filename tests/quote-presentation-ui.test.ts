import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editor = readFileSync(
  new URL("../src/components/quote-structured-lines-editor.tsx", import.meta.url),
  "utf-8",
);
const panel = readFileSync(
  new URL("../src/components/quote-item-presentation-panel.tsx", import.meta.url),
  "utf-8",
);

describe("quote client presentation UI", () => {
  it("offers formatting and photo buttons on headings and ouvrages", () => {
    expect(editor).toContain("Mise en forme client");
    expect(editor).toContain("Photos de la ligne");
    expect(editor).toContain("QuoteItemPresentationPanel");
    expect(editor).toContain("quoteItemTextStyleToCss");
  });

  it("offers font, size, colors, highlighter, bold, italic and client photo visibility", () => {
    for (const label of ["Police", "Taille", "Couleur", "Surligneur", "Visible client"]) {
      expect(panel).toContain(label);
    }
    expect(panel).toContain("<Bold");
    expect(panel).toContain("<Italic");
    expect(panel).toContain('accept="image/jpeg,image/png,image/webp"');
  });
});
