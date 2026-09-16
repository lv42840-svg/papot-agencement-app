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

  it("renders the rich editor inside the designation grid cell instead of a floating window", () => {
    const wrapper = source("src/components/quote-structured-lines-rich-editor.tsx");

    expect(wrapper).toContain("createPortal");
    expect(wrapper).toContain("quoteRichInlineHost");
    expect(wrapper).toContain('input.insertAdjacentElement("beforebegin", host)');
    expect(wrapper).toContain('input.style.display = "none"');
    expect(wrapper).not.toContain("quoteRichInlineOverlay");
    expect(wrapper).not.toContain("position: fixed");
  });

  it("keeps the display layer passive instead of opening a second editor", () => {
    const layer = source("src/components/quote-rich-text-layer.tsx");

    expect(layer).toContain("paintRichText");
    expect(layer).not.toContain("createPortal");
    expect(layer).not.toContain("QuoteRichTextEditor");
    expect(layer).not.toContain("handleClick");
    expect(layer).not.toContain('role="dialog"');
  });

  it("offers exactly five predefined text colors and no free color picker", () => {
    const editor = source("src/components/quote-rich-text-editor.tsx");

    expect(editor).toContain('{ label: "Noir", value: "#111827" }');
    expect(editor).toContain('{ label: "Violet PAPOT", value: "#6554b5" }');
    expect(editor).toContain('{ label: "Bleu", value: "#2563eb" }');
    expect(editor).toContain('{ label: "Vert", value: "#15803d" }');
    expect(editor).toContain('{ label: "Rouge", value: "#b42318" }');
    expect(editor).toContain('aria-label="Couleur du texte"');
    expect(editor).not.toContain('type="color"');
  });

  it("keeps the useful formatting controls in the inline band", () => {
    const editor = source("src/components/quote-rich-text-editor.tsx");

    expect(editor).toContain("Gras");
    expect(editor).toContain("Italique");
    expect(editor).toContain("Souligné");
    expect(editor).toContain("Surlignage jaune");
    expect(editor).toContain("Taille du texte");
    expect(editor).toContain("contentEditable");
  });

  it("inserts and preserves real line breaks in rich quote text", () => {
    const editor = source("src/components/quote-rich-text-editor.tsx");
    const wrapper = source("src/components/quote-structured-lines-rich-editor.tsx");

    expect(editor).toContain('aria-multiline="true"');
    expect(editor).toContain('insertPlainTextAtSelection(event.currentTarget, "\\n", maxLength)');
    expect(editor).toContain('.replace(/\\r\\n?/g, "\\n")');
    expect(editor).not.toContain('if (event.key === "Enter") event.preventDefault()');
    expect(wrapper).toContain("plainTextForNativeInput");
    expect(wrapper).toContain('value.replace(/\\r\\n?|\\n/g, " ")');
    expect(wrapper).not.toContain("itemText(item) === plainText");
  });

  it("keeps saved line breaks visible after leaving rich-text edit mode", () => {
    const layer = source("src/components/quote-rich-text-layer.tsx");

    expect(layer).toContain('whiteSpace: "pre-wrap"');
    expect(layer).toContain('overflowWrap: "anywhere"');
    expect(layer).toContain('overflow: "visible"');
    expect(layer).toContain('textOverflow: "clip"');
    expect(layer).toContain('".quoteHeadingRow > strong, .quoteLineDescription > strong"');
  });
});
