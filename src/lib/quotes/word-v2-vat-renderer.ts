import { cloneZipEntryWithData, readZipArchive, writeZipArchive } from "../documents/zip-archive";
import type { QuoteDocumentData, QuoteDocumentTaxLine } from "./document-data";

const VAT_SUMMARY_ANCHOR = "{{PAPOT_VAT_SUMMARY}}";
const VAT_LINES_ANCHOR = "{{PAPOT_VAT_LINES_ANCHOR}}";
const WORD_TABLE_CELL_PATTERN = /<w:tc\b[\s\S]*?<\/w:tc>/g;
const FINANCIAL_TOTALS_WIDTHS = [2900, 1672] as const;

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

type XmlRange = {
  start: number;
  end: number;
};

type AnchoredRow = {
  range: XmlRange;
  rowXml: string;
  cells: string[];
  anchorCellIndex: number;
};

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatMoney(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

function formatVatRate(ratePercent: number): string {
  return `${percentFormatter.format(ratePercent)} %`;
}

function findOpeningTagStart(xml: string, tagName: string, beforeIndex: number): number {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>`, "g");
  let lastStart = -1;
  for (const match of xml.slice(0, beforeIndex + 1).matchAll(pattern)) {
    if (match.index !== undefined) lastStart = match.index;
  }
  return lastStart;
}

function containingRange(xml: string, anchorIndex: number, tagName: string): XmlRange | null {
  const start = findOpeningTagStart(xml, tagName, anchorIndex);
  if (start < 0) return null;
  const closingTag = `</${tagName}>`;
  const closeStart = xml.indexOf(closingTag, anchorIndex);
  if (closeStart < 0) return null;
  return { start, end: closeStart + closingTag.length };
}

function uniqueAnchorIndex(xml: string, token: string): number {
  const first = xml.indexOf(token);
  if (first < 0) throw new Error(`QUOTE_WORD_V2_VAT_ANCHOR_MISSING:${token}`);
  if (xml.indexOf(token, first + token.length) >= 0) {
    throw new Error(`QUOTE_WORD_V2_VAT_ANCHOR_DUPLICATE:${token}`);
  }
  return first;
}

function anchoredRow(xml: string, token: string): AnchoredRow {
  const anchorIndex = uniqueAnchorIndex(xml, token);
  const range = containingRange(xml, anchorIndex, "w:tr");
  if (!range) throw new Error(`QUOTE_WORD_V2_VAT_ROW_MISSING:${token}`);

  const rowXml = xml.slice(range.start, range.end);
  const cells = Array.from(rowXml.matchAll(WORD_TABLE_CELL_PATTERN), (match) => match[0]);
  if (cells.length === 0) throw new Error(`QUOTE_WORD_V2_VAT_ROW_EMPTY:${token}`);

  const anchorCellIndex = cells.findIndex((cell) => cell.includes(token));
  if (anchorCellIndex < 0) throw new Error(`QUOTE_WORD_V2_VAT_CELL_MISSING:${token}`);

  return { range, rowXml, cells, anchorCellIndex };
}

function cellProperties(cellXml: string): string {
  return cellXml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/)?.[0] ?? "";
}

function normalizedCellProperties(cellXml: string, width: number): string {
  let properties = cellProperties(cellXml);
  properties = properties.replace(/<w:gridSpan\b[^>]*\/>/g, "");
  if (/<w:tcW\b[^>]*\/>/.test(properties)) {
    properties = properties.replace(
      /<w:tcW\b[^>]*\/>/,
      `<w:tcW w:w="${width}" w:type="dxa"/>`,
    );
  } else if (properties) {
    properties = properties.replace(
      "</w:tcPr>",
      `<w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>`,
    );
  } else {
    properties = `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>`;
  }
  return properties;
}

function paragraphProperties(cellXml: string): string {
  return cellXml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
}

function runProperties(cellXml: string): string {
  return cellXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
}

function paragraphWithAlignment(properties: string, alignment?: "left" | "right"): string {
  if (!alignment) return properties;
  const jc = `<w:jc w:val="${alignment}"/>`;
  if (/<w:jc\b[^>]*\/>/.test(properties)) {
    return properties.replace(/<w:jc\b[^>]*\/>/, jc);
  }
  return properties
    ? properties.replace("</w:pPr>", `${jc}</w:pPr>`)
    : `<w:pPr>${jc}</w:pPr>`;
}

function cellWithText(
  templateCell: string,
  value: string,
  options: { width?: number; align?: "left" | "right" } = {},
): string {
  const text = escapeXmlText(value);
  const tcPr =
    options.width === undefined
      ? cellProperties(templateCell)
      : normalizedCellProperties(templateCell, options.width);
  const pPr = paragraphWithAlignment(paragraphProperties(templateCell), options.align);
  const rPr = runProperties(templateCell);

  return [
    `<w:tc>${tcPr}`,
    `<w:p>${pPr}`,
    `<w:r>${rPr}`,
    `<w:t xml:space="preserve">${text}</w:t>`,
    "</w:r></w:p></w:tc>",
  ].join("");
}

function rowWithLabelAndAmount(template: AnchoredRow, label: string, amount: string): string {
  const rowProperties = template.rowXml.match(/<w:trPr>[\s\S]*?<\/w:trPr>/)?.[0] ?? "";
  const lastCellIndex = template.cells.length - 1;

  if (template.cells.length === 1 || template.anchorCellIndex === lastCellIndex) {
    const sourceCell = template.cells[template.anchorCellIndex]!;
    const labelCell = cellWithText(sourceCell, label, {
      width: FINANCIAL_TOTALS_WIDTHS[0],
      align: "left",
    });
    const amountCell = cellWithText(sourceCell, amount, {
      width: FINANCIAL_TOTALS_WIDTHS[1],
      align: "right",
    });
    return `<w:tr>${rowProperties}${labelCell}${amountCell}</w:tr>`;
  }

  const cells = template.cells.map((cell, index) => {
    if (index === template.anchorCellIndex) {
      return cellWithText(cell, label, { align: "left" });
    }
    if (index === lastCellIndex) {
      return cellWithText(cell, amount, { align: "right" });
    }
    return cell;
  });

  return `<w:tr>${rowProperties}${cells.join("")}</w:tr>`;
}

function replaceAnchoredRow(
  xml: string,
  token: string,
  render: (template: AnchoredRow) => string,
): string {
  const template = anchoredRow(xml, token);
  return `${xml.slice(0, template.range.start)}${render(template)}${xml.slice(template.range.end)}`;
}

function removeAnchoredRow(xml: string, token: string): string {
  const template = anchoredRow(xml, token);
  return `${xml.slice(0, template.range.start)}${xml.slice(template.range.end)}`;
}

function taxLineLabel(line: QuoteDocumentTaxLine): string {
  return `TVA ${formatVatRate(line.ratePercent)} sur ${formatMoney(line.baseHtCents)} HT`;
}

export function replaceQuoteVatAnchors(documentXml: string, document: QuoteDocumentData): string {
  const taxLines = document.totals.taxLines;
  const summaryLabel =
    taxLines.length === 1 ? `TVA ${formatVatRate(taxLines[0]!.ratePercent)}` : "Total TVA";

  let next = replaceAnchoredRow(documentXml, VAT_SUMMARY_ANCHOR, (template) =>
    rowWithLabelAndAmount(template, summaryLabel, formatMoney(document.totals.totalVatCents)),
  );

  if (taxLines.length <= 1) {
    next = removeAnchoredRow(next, VAT_LINES_ANCHOR);
    return next;
  }

  next = replaceAnchoredRow(next, VAT_LINES_ANCHOR, (template) =>
    taxLines
      .map((line) =>
        rowWithLabelAndAmount(template, taxLineLabel(line), formatMoney(line.vatCents)),
      )
      .join(""),
  );

  return next;
}

export function renderQuoteWordV2Vat(
  template: Uint8Array,
  document: QuoteDocumentData,
): Uint8Array {
  const entries = readZipArchive(template);
  let documentXmlFound = false;

  const renderedEntries = entries.map((entry) => {
    if (entry.name !== "word/document.xml") return entry;
    documentXmlFound = true;
    const xml = Buffer.from(entry.data).toString("utf8");
    const rendered = replaceQuoteVatAnchors(xml, document);
    return cloneZipEntryWithData(entry, Buffer.from(rendered, "utf8"));
  });

  if (!documentXmlFound) throw new Error("QUOTE_WORD_V2_DOCUMENT_XML_MISSING");
  return writeZipArchive(renderedEntries);
}
