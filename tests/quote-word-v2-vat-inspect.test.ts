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

function rowText(row: string): string[] {
  return Array.from(row.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g), (cellMatch) =>
    Array.from(cellMatch[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g))
      .map((match) => decodeXmlText(match[1]))
      .join(""),
  );
}

function rowContaining(xml: string, anchor: string): string {
  const anchorIndex = xml.indexOf(anchor);
  expect(anchorIndex).toBeGreaterThanOrEqual(0);
  const rowStartCandidates = Array.from(
    xml.slice(0, anchorIndex + 1).matchAll(/<w:tr(?:\s[^>]*)?>/g),
  );
  const rowStart = rowStartCandidates.at(-1)?.index ?? -1;
  const rowCloseStart = xml.indexOf("</w:tr>", anchorIndex);
  expect(rowStart).toBeGreaterThanOrEqual(0);
  expect(rowCloseStart).toBeGreaterThanOrEqual(0);
  return xml.slice(rowStart, rowCloseStart + "</w:tr>".length);
}

function surroundingRows(xml: string, row: string): { previous: string[] | null; current: string[]; next: string[] | null } {
  const rowStart = xml.indexOf(row);
  const rowEnd = rowStart + row.length;
  const previousClose = xml.lastIndexOf("</w:tr>", rowStart - 1);
  let previous: string[] | null = null;
  if (previousClose >= 0) {
    const candidates = Array.from(xml.slice(0, previousClose + 1).matchAll(/<w:tr(?:\s[^>]*)?>/g));
    const previousStart = candidates.at(-1)?.index ?? -1;
    if (previousStart >= 0) previous = rowText(xml.slice(previousStart, previousClose + "</w:tr>".length));
  }

  const nextStart = xml.slice(rowEnd).search(/<w:tr(?:\s[^>]*)?>/);
  let next: string[] | null = null;
  if (nextStart >= 0) {
    const absoluteNextStart = rowEnd + nextStart;
    const nextClose = xml.indexOf("</w:tr>", absoluteNextStart);
    if (nextClose >= 0) next = rowText(xml.slice(absoluteNextStart, nextClose + "</w:tr>".length));
  }

  return { previous, current: rowText(row), next };
}

describe("inspection temporaire Word V2 TVA", () => {
  it("affiche les vraies lignes des ancres TVA", () => {
    const template = readFileSync(templatePath);
    const documentEntry = readZipArchive(template).find((entry) => entry.name === "word/document.xml");
    expect(documentEntry).toBeDefined();
    const xml = Buffer.from(documentEntry!.data).toString("utf8");

    const summaryRow = rowContaining(xml, "PAPOT_VAT_SUMMARY");
    const linesRow = rowContaining(xml, "PAPOT_VAT_LINES_ANCHOR");

    throw new Error(
      `PAPOT_VAT_LAYOUT:${JSON.stringify({
        summary: surroundingRows(xml, summaryRow),
        lines: surroundingRows(xml, linesRow),
      })}`,
    );
  });
});
