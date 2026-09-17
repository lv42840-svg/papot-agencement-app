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

describe("inspection temporaire Word V2 options", () => {
  it("affiche la structure réelle autour de PAPOT_OPTIONS_BLOCK", () => {
    const template = readFileSync(templatePath);
    const documentEntry = readZipArchive(template).find((entry) => entry.name === "word/document.xml");
    expect(documentEntry).toBeDefined();
    const xml = Buffer.from(documentEntry!.data).toString("utf8");
    const anchorIndex = xml.indexOf("PAPOT_OPTIONS_BLOCK");
    expect(anchorIndex).toBeGreaterThanOrEqual(0);

    const rowStart = xml.lastIndexOf("<w:tr", anchorIndex);
    const rowEnd = xml.indexOf("</w:tr>", anchorIndex) + "</w:tr>".length;
    const anchorRow = xml.slice(rowStart, rowEnd);

    const previousRowEnd = rowStart;
    const previousRowStart = xml.lastIndexOf("<w:tr", xml.lastIndexOf("</w:tr>", previousRowEnd - 1));
    const previousRow =
      previousRowStart >= 0 ? xml.slice(previousRowStart, xml.indexOf("</w:tr>", previousRowStart) + 7) : "";

    const nextRowStart = xml.indexOf("<w:tr", rowEnd);
    const nextRow =
      nextRowStart >= 0 ? xml.slice(nextRowStart, xml.indexOf("</w:tr>", nextRowStart) + 7) : "";

    const tableStart = xml.lastIndexOf("<w:tbl", anchorIndex);
    const tableEnd = xml.indexOf("</w:tbl>", anchorIndex) + "</w:tbl>".length;
    const table = xml.slice(tableStart, tableEnd);
    const tableRows = Array.from(table.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g), (match) => match[0]);

    throw new Error(
      `PAPOT_OPTIONS_LAYOUT:${JSON.stringify({
        tableRowCount: tableRows.length,
        tableRows: tableRows.map(rowSummary),
        previousRow: previousRow ? rowSummary(previousRow) : null,
        anchorRow: rowSummary(anchorRow),
        nextRow: nextRow ? rowSummary(nextRow) : null,
      })}`,
    );
  });
});
