import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editor = readFileSync(
  new URL("../src/components/quote-structured-lines-editor.tsx", import.meta.url),
  "utf-8",
);
const richWrapper = readFileSync(
  new URL("../src/components/quote-structured-lines-rich-editor.tsx", import.meta.url),
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
  it("keeps photo actions while the legacy palette is hidden", () => {
    expect(editor).toContain("Photos de la ligne");
    expect(editor).toContain("QuoteItemPresentationPanel");
    expect(richWrapper).toContain('button[title="Mise en forme client"]');
    expect(richWrapper).toContain("display: none !important");
  });

  it("keeps the former presentation panel focused on photos only", () => {
    expect(panel).toContain("Photos de la ligne");
    expect(panel).toContain("Visible client");
    expect(panel).toContain("Voir la photo en grand");
    expect(panel).toContain("quotePhotoLightbox");
    expect(panel).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(panel).not.toContain("HIGHLIGHT_COLOR_PRESETS");
    expect(panel).not.toContain("updateItemPresentation");
    expect(panel).not.toContain("saveStyle");
    expect(panel).not.toContain("<Bold");
    expect(panel).not.toContain("<Italic");
    expect(panel).not.toContain("Surligneur");
  });

  it("mounts the rich editor in the real editing flow", () => {
    expect(directEditor).toContain("QuoteStructuredLinesRichEditor");
    expect(directEditor).toContain("QuoteRichTextLayer");
    expect(directEditor).not.toContain("QuoteInlineTextColorToolbar");
    expect(richWrapper).toContain("QuoteRichTextEditor");
    expect(richEditor).toContain('aria-label="Couleur du texte"');
    expect(richEditor).toContain("contentEditable");
    expect(richEditor).toContain("<Bold");
    expect(richEditor).toContain("<Italic");
    expect(richEditor).toContain("<Underline");
  });
});
