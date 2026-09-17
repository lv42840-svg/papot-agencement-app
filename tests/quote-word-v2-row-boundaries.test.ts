import { describe, expect, it } from "vitest";
import type { QuoteDocumentData } from "../src/lib/quotes/document-data";
import { replaceQuoteBodyAnchor } from "../src/lib/quotes/word-v2-renderer";

function makeDocument(): QuoteDocumentData {
  return {
    items: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "LINE",
        number: "1",
        parentId: null,
        text: "Ligne test",
        richText: null,
        clientPhotos: [],
        scope: "MAIN",
        optionId: null,
        optionLabel: null,
        optionStatus: null,
        quantity: 1,
        unit: "u",
        unitPriceHt: 100,
        totalHtCents: 10000,
        vatRatePercent: 20,
        vatCents: 2000,
      },
    ],
  } as QuoteDocumentData;
}

function templateCell(text = ""): string {
  return `<w:tc><w:tcPr/><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
}

describe("quote Word V2 row boundaries", () => {
  it("remplace toute la ligne ancre sans confondre w:tr avec w:trPr", () => {
    const anchorRow = `<w:tr><w:trPr><w:cantSplit/></w:trPr>${[
      templateCell(),
      templateCell("{{PAPOT_QUOTE_BODY}}"),
      templateCell(),
      templateCell(),
      templateCell(),
      templateCell(),
    ].join("")}</w:tr>`;
    const xml = `<w:document><w:body><w:tbl>${anchorRow}</w:tbl></w:body></w:document>`;

    const rendered = replaceQuoteBodyAnchor(xml, makeDocument());

    expect(rendered).not.toContain("PAPOT_QUOTE_BODY");
    expect(rendered).toContain("Ligne test");
    expect(rendered).not.toMatch(/<w:tr(?:\s[^>]*)?>\s*<w:tr(?:\s|>)/);
    expect(rendered.match(/<w:tr(?:\s[^>]*)?>/g)).toHaveLength(1);
  });
});
