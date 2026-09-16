import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("quote rich text UI wiring", () => {
  it("mounts the rich text layer instead of the legacy floating color toolbar", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/components/quote-direct-editor.tsx"),
      "utf8",
    );

    expect(source).toContain("QuoteRichTextLayer");
    expect(source).not.toContain("QuoteInlineTextColorToolbar");
  });

  it("exposes the requested formatting controls while editing", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/components/quote-rich-text-editor.tsx"),
      "utf8",
    );

    expect(source).toContain("Gras");
    expect(source).toContain("Italique");
    expect(source).toContain("Souligné");
    expect(source).toContain("Couleur du texte");
    expect(source).toContain("Surlignage");
    expect(source).toContain("Taille du texte");
    expect(source).toContain("contentEditable");
  });
});
