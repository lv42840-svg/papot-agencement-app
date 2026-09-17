import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readZipArchive } from "../src/lib/documents/zip-archive";

const templatePath = new URL("../docs/templates/PAPOT_Template_Devis_V2.docx", import.meta.url);

function decodeXmlText(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function rowSummary(row: string) {
  const cells = Array.from(row.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g), (match) => match[0]);
  return {
    cellCount: cells.length,
    cells: cells.map((cell, index) => ({
      index,
      text: Array.from(cell.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
        .map((match) => decodeXmlText(match[1]))
        .join(""),
      gridSpan: cell.match(/<w:gridSpan w:val="(\d+)"\s*\/>/)?.[1] ?? null,
      width: cell.match(/<w:tcW w:w="(\d+)" w:type="([^"]+)"\s*\/>/)?.slice(1) ?? null,
    })),
    rowProperties: row.match(/<w:trPr>[\s\S]*?<\/w:trPr>/)?.[0] ?? null,
  };
}

function openingTagStart(xml: string, tag: string, beforeIndex: number): number {
  const matches = Array.from(xml.slice(0, beforeIndex + 1).matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>`, "g")));
  return matches.at(-1)?.index ?? -1;
}

function rowContaining(xml: string, anchor: string): { xml: string; start: number; end: number } {
  const anchorIndex = xml.indexOf(anchor);
  expect(anchorIndex).toBeGreaterThanOrEqual(0);
  const start = openingTagStart(xml, "w:tr", anchorIndex);
  const closeStart = xml.indexOf("</w:tr>", anchorIndex);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(closeStart).toBeGreaterThanOrEqual(0);
  const end = closeStart + "</w:tr>".length;
  return { xml: xml.slice(start, end), start, end };
}

function tableContaining(xml: string, anchorIndex: number): { start: number; end: number; rows: ReturnType<typeof rowSummary>[] } {
  const start = openingTagStart(xml, "w:tbl", anchorIndex);
  const closeStart = xml.indexOf("</w:tbl>", anchorIndex);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(closeStart).toBeGreaterThanOrEqual(0);
  const end = closeStart + "</w:tbl>".length;
  const tableXml = xml.slice(start, end);
  return {
    start,
    end,
    rows: Array.from(tableXml.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g), (match) => rowSummary(match[0])),
  };
}

describe("inspection temporaire Word V2 TVA", () => {
  it("affiche la structure exacte des ancres TVA", () => {
    const template = readFileSync(templatePath);
    const documentEntry = readZipArchive(template).find((entry) => entry.name === "word/document.xml");
    expect(documentEntry).toBeDefined();
    const xml = Buffer.from(documentEntry!.data).toString("utf8");

    const summaryAnchorIndex = xml.indexOf("PAPOT_VAT_SUMMARY");
    const linesAnchorIndex = xml.indexOf("PAPOT_VAT_LINES_ANCHOR");
    const summaryRow = rowContaining(xml, "PAPOT_VAT_SUMMARY");
    const linesRow = rowContaining(xml, "PAPOT_VAT_LINES_ANCHOR");
    const summaryTable = tableContaining(xml, summaryAnchorIndex);
    const linesTable = tableContaining(xml, linesAnchorIndex);

    throw new Error(
      `PAPOT_VAT_STRUCTURE:${JSON.stringify({
        sameTable: summaryTable.start === linesTable.start && summaryTable.end === linesTable.end,
        summaryRow: rowSummary(summaryRow.xml),
        linesRow: rowSummary(linesRow.xml),
        summaryTableRowCount: summaryTable.rows.length,
        summaryTableRows: summaryTable.rows,
        linesTableRowCount: linesTable.rows.length,
        linesTableRows: linesTable.rows,
      })}`,
    );
  });
});
