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

function cellText(cellXml: string): string {
  return Array.from(cellXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
    .map((match) => decodeXmlText(match[1]))
    .join("");
}

describe("inspection temporaire Word V2 body", () => {
  it("affiche la vraie ligne contenant PAPOT_QUOTE_BODY", () => {
    const template = readFileSync(templatePath);
    const documentEntry = readZipArchive(template).find((entry) => entry.name === "word/document.xml");
    expect(documentEntry).toBeDefined();
    const xml = Buffer.from(documentEntry!.data).toString("utf8");
    const anchorIndex = xml.indexOf("PAPOT_QUOTE_BODY");
    expect(anchorIndex).toBeGreaterThanOrEqual(0);
    const rowStart = xml.lastIndexOf("<w:tr", anchorIndex);
    const rowEnd = xml.indexOf("</w:tr>", anchorIndex) + "</w:tr>".length;
    const row = xml.slice(rowStart, rowEnd);
    const cells = Array.from(row.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g), (match) => match[0]);
    const summary = {
      cellCount: cells.length,
      cells: cells.map((cell, index) => ({
        index,
        text: cellText(cell),
        gridSpan: cell.match(/<w:gridSpan w:val="(\d+)"\s*\/>/)?.[1] ?? null,
        width: cell.match(/<w:tcW w:w="(\d+)" w:type="([^"]+)"\s*\/>/)?.slice(1) ?? null,
      })),
      rowProperties: row.match(/<w:trPr>[\s\S]*?<\/w:trPr>/)?.[0] ?? null,
    };
    throw new Error(`PAPOT_QUOTE_BODY_ROW:${JSON.stringify(summary)}`);
  });
});
