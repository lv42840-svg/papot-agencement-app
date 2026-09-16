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
const directEditor = readFileSync(
  new URL("../src/components/quote-direct-editor.tsx", import.meta.url),
  "utf-8",
);
const richEditor = readFileSync(
  new URL("../src/components/quote-rich-text-editor.tsx", import.meta.url),
  "utf-8",
);

describe("quote client presentation UI", () => {
  it("offers formatting and photo buttons on headings and ouvrages", () => {
    expect(editor).toContain("Mise en forme client");
    expect(editor).toContain("Photos de la ligne");
    expect(editor).toContain("QuoteItemPresentationPanel");
    expect(editor).toContain("quoteItemTextStyleToCss");
  });

  it("keeps whole-item formatting without a whole-item text color picker", () => {
    for (const label of ["Police", "Taille", "Surligneur", "Visible client"]) {
      expect(panel).toContain(label);
    }
    expect(panel).not.toContain("TEXT_COLOR_PRESETS");
    expect(panel).not.toContain("quoteColorControl");
    expect(panel).toContain("HIGHLIGHT_COLOR_PRESETS");
    expect(panel).toContain('{ label: "Jaune", value: "#fff2a8" }');
    expect(panel).not.toContain('type="color"');
    expect(panel).toContain("<Bold");
    expect(panel).toContain("<Italic");
    expect(panel).toContain('accept="image/jpeg,image/png,image/webp"');
  });

  it("mounts the rich text editor instead of the legacy selection color toolbar", () => {
    expect(directEditor).toContain("QuoteRichTextLayer");
    expect(directEditor).not.toContain("QuoteInlineTextColorToolbar");
    expect(richEditor).toContain('aria-label="Couleur du texte"');
    expect(richEditor).toContain("contentEditable");
    expect(richEditor).toContain("<Bold");
    expect(richEditor).toContain("<Italic");
    expect(richEditor).toContain("<Underline");
  });
});
