import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readZipArchive } from "../src/lib/documents/zip-archive";
import type { QuoteDocumentData } from "../src/lib/quotes/document-data";
import { renderQuoteWordV2VatSummary } from "../src/lib/quotes/word-v2-vat-summary";

const templatePath = new URL("../docs/templates/PAPOT_Template_Devis_V2.docx", import.meta.url);

function documentXml(docx: Uint8Array): string {
  const entry = readZipArchive(docx).find((candidate) => candidate.name === "word/document.xml");
  expect(entry).toBeDefined();
  return Buffer.from(entry!.data).toString("utf8");
}

function textContent(xml: string): string {
  return Array.from(xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((match) =>
      match[1]
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'"),
    )
    .join("")
    .replace(/\s+/g, " ");
}

function openingTagStart(xml: string, tag: string, beforeIndex: number): number {
  const matches = Array.from(xml.slice(0, beforeIndex + 1).matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>`, "g")));
  return matches.at(-1)?.index ?? -1;
}

function totalsTable(xml: string): string {
  const anchorIndex = xml.indexOf("Total net HT");
  expect(anchorIndex).toBeGreaterThanOrEqual(0);
  const start = openingTagStart(xml, "w:tbl", anchorIndex);
  const closeStart = xml.indexOf("</w:tbl>", anchorIndex);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(closeStart).toBeGreaterThanOrEqual(0);
  return xml.slice(start, closeStart + "</w:tbl>".length);
}

function tableRowCount(tableXml: string): number {
  return Array.from(tableXml.matchAll(/<w:tr(?:\s[^>]*)?>/g)).length;
}

function makeDocument(
  totalVatCents: number,
  taxLines: Array<{ ratePercent: number; baseHtCents: number; vatCents: number }>,
): QuoteDocumentData {
  return {
    totals: {
      totalHtCents: taxLines.reduce((sum, line) => sum + line.baseHtCents, 0),
      totalVatCents,
      totalTtcCents:
        taxLines.reduce((sum, line) => sum + line.baseHtCents, 0) + totalVatCents,
      taxLines,
    },
  } as unknown as QuoteDocumentData;
}

describe("quote Word V2 VAT summary", () => {
  it("affiche un résumé compact et supprime la ventilation avec un seul taux", () => {
    const rendered = renderQuoteWordV2VatSummary(
      readFileSync(templatePath),
      makeDocument(20000, [{ ratePercent: 20, baseHtCents: 100000, vatCents: 20000 }]),
    );
    const xml = documentXml(rendered);
    const table = totalsTable(xml);
    const text = textContent(table);

    expect(Buffer.from(rendered).subarray(0, 2).toString("ascii")).toBe("PK");
    expect(xml).not.toContain("PAPOT_VAT_SUMMARY");
    expect(xml).not.toContain("PAPOT_VAT_LINES_ANCHOR");
    expect(text).toContain("TVA20 % : 200,00 €");
    expect(tableRowCount(table)).toBe(4);
    expect(xml).toContain("{{total_ht}}");
    expect(xml).toContain("{{total_ttc}}");
    expect(xml).toContain("{{net_a_payer}}");
  });

  it("affiche le total TVA puis une ligne par taux quand plusieurs taux existent", () => {
    const rendered = renderQuoteWordV2VatSummary(
      readFileSync(templatePath),
      makeDocument(25000, [
        { ratePercent: 20, baseHtCents: 100000, vatCents: 20000 },
        { ratePercent: 10, baseHtCents: 50000, vatCents: 5000 },
      ]),
    );
    const xml = documentXml(rendered);
    const table = totalsTable(xml);
    const text = textContent(table);

    expect(xml).not.toContain("PAPOT_VAT_SUMMARY");
    expect(xml).not.toContain("PAPOT_VAT_LINES_ANCHOR");
    expect(text).toContain("TVA250,00 €");
    expect(text).toContain("TVA 10 % sur 500,00 € HT : 50,00 €");
    expect(text).toContain("TVA 20 % sur 1 000,00 € HT : 200,00 €");
    expect(text.indexOf("TVA 10 % sur")).toBeLessThan(text.indexOf("TVA 20 % sur"));
    expect(tableRowCount(table)).toBe(6);
    expect(xml).toContain("{{total_ht}}");
    expect(xml).toContain("{{total_ttc}}");
    expect(xml).toContain("{{net_a_payer}}");
  });

  it("affiche une TVA nulle et retire la ligne de ventilation sans taux", () => {
    const rendered = renderQuoteWordV2VatSummary(
      readFileSync(templatePath),
      makeDocument(0, []),
    );
    const xml = documentXml(rendered);
    const table = totalsTable(xml);
    const text = textContent(table);

    expect(xml).not.toContain("PAPOT_VAT_SUMMARY");
    expect(xml).not.toContain("PAPOT_VAT_LINES_ANCHOR");
    expect(text).toContain("TVA0,00 €");
    expect(tableRowCount(table)).toBe(4);
  });
});
