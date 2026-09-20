import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readZipArchive } from "../src/lib/documents/zip-archive";
import type { QuoteDocumentData, QuoteDocumentTaxLine } from "../src/lib/quotes/document-data";
import { renderQuoteWordV2Vat } from "../src/lib/quotes/word-v2-vat-renderer";

const templatePath = new URL("../docs/templates/PAPOT_Template_Devis_V2.docx", import.meta.url);

function documentXml(docx: Uint8Array): string {
  const entry = readZipArchive(docx).find((candidate) => candidate.name === "word/document.xml");
  if (!entry) throw new Error("TEST_DOCUMENT_XML_MISSING");
  return Buffer.from(entry.data).toString("utf8");
}

function rowCount(xml: string): number {
  return Array.from(xml.matchAll(/<w:tr(?:\s[^>]*)?>/g)).length;
}

function rowContaining(xml: string, text: string): string {
  const row = Array.from(xml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g))
    .map((match) => match[0])
    .find((candidate) => candidate.includes(text));
  if (!row) throw new Error(`TEST_ROW_MISSING:${text}`);
  return row;
}


function makeDocument(taxLines: QuoteDocumentTaxLine[]): QuoteDocumentData {
  return {
    totals: {
      totalVatCents: taxLines.reduce((sum, line) => sum + line.vatCents, 0),
      taxLines,
    },
  } as unknown as QuoteDocumentData;
}

describe("quote Word V2 VAT", () => {
  it("rend une TVA simple sur une seule ligne de total", () => {
    const template = readFileSync(templatePath);
    const originalXml = documentXml(template);
    const rendered = renderQuoteWordV2Vat(
      template,
      makeDocument([{ ratePercent: 20, baseHtCents: 12_345, vatCents: 2_469 }]),
    );
    const xml = documentXml(rendered);

    expect(xml).not.toContain("{{PAPOT_VAT_SUMMARY}}");
    expect(xml).not.toContain("{{PAPOT_VAT_LINES_ANCHOR}}");
    expect(xml).toContain("TVA 20 %");
    expect(xml).toContain("24,69");
    expect(xml).not.toContain("sur 123,45");
    const vatRow = rowContaining(xml, "TVA 20 %");
    expect((vatRow.match(/<w:tc\b/g) ?? []).length).toBe(2);
    expect(vatRow).toContain('<w:tcW w:w="2900" w:type="dxa"/>');
    expect(vatRow).toContain('<w:tcW w:w="1672" w:type="dxa"/>');
    expect(vatRow).toContain('<w:jc w:val="right"/>');
    expect(xml).toContain("{{total_ht}}");
    expect(xml).toContain("{{total_ttc}}");
    expect(rowCount(xml)).toBe(rowCount(originalXml) - 1);
  });

  it("detaille chaque taux lorsqu'un devis contient plusieurs TVA", () => {
    const template = readFileSync(templatePath);
    const originalXml = documentXml(template);
    const rendered = renderQuoteWordV2Vat(
      template,
      makeDocument([
        { ratePercent: 5.5, baseHtCents: 10_000, vatCents: 550 },
        { ratePercent: 20, baseHtCents: 20_000, vatCents: 4_000 },
      ]),
    );
    const xml = documentXml(rendered);

    expect(xml).not.toContain("{{PAPOT_VAT_SUMMARY}}");
    expect(xml).not.toContain("{{PAPOT_VAT_LINES_ANCHOR}}");
    expect(xml).toContain("Total TVA");
    expect(xml).toContain("45,50");
    expect(xml).toContain("TVA 5,5 % sur");
    expect(xml).toContain("100,00");
    expect(xml).toContain("5,50");
    expect(xml).toContain("TVA 20 % sur");
    expect(xml).toContain("200,00");
    expect(xml).toContain("40,00");
    expect(xml).toContain("{{total_ht}}");
    expect(xml).toContain("{{total_ttc}}");
    expect(rowCount(xml)).toBe(rowCount(originalXml) + 1);
  });
});
