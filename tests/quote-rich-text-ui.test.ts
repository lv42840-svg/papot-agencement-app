import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("quote rich text UI wiring", () => {
  it("uses the rich wrapper in the real structured quote editor", () => {
    const directEditor = source("src/components/quote-direct-editor.tsx");

    expect(directEditor).toContain("QuoteStructuredLinesRichEditor");
    expect(directEditor).toContain("QuoteRichTextLayer");
    expect(directEditor).not.toContain("QuoteInlineTextColorToolbar");
    expect(directEditor).not.toContain("<QuoteStructuredLinesEditor");
  });

  it("replaces the actual title and designation inputs while they are being edited", () => {
    const wrapper = source("src/components/quote-structured-lines-rich-editor.tsx");

    expect(wrapper).toContain(".quoteHeadingEditing .quoteDescriptionInput");
    expect(wrapper).toContain(".quoteOuvrageEditing .quoteDescriptionInput");
    expect(wrapper).toContain("QuoteRichTextEditor");
    expect(wrapper).toContain("setNativeInputValue");
    expect(wrapper).toContain('root.addEventListener("submit", rememberPendingSave, true)');
    expect(wrapper).toContain("/rich-text");
  });

  it("hides the obsolete palette button from the quote rows", () => {
    const wrapper = source("src/components/quote-structured-lines-rich-editor.tsx");

    expect(wrapper).toContain('button[title="Mise en forme client"]');
    expect(wrapper).toContain("display: none !important");
  });

  it("keeps the display layer passive instead of opening a second editor", () => {
    const layer = source("src/components/quote-rich-text-layer.tsx");

    expect(layer).toContain("paintRichText");
    expect(layer).not.toContain("createPortal");
    expect(layer).not.toContain("QuoteRichTextEditor");
    expect(layer).not.toContain("handleClick");
    expect(layer).not.toContain('role="dialog"');
  });

  it("exposes the requested formatting controls in the inline band", () => {
    const editor = source("src/components/quote-rich-text-editor.tsx");

    expect(editor).toContain("Gras");
    expect(editor).toContain("Italique");
    expect(editor).toContain("Souligné");
    expect(editor).toContain("Couleur du texte");
    expect(editor).toContain("Surlignage");
    expect(editor).toContain("Taille du texte");
    expect(editor).toContain("contentEditable");
  });
});
