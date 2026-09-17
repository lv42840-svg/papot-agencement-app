import { cloneZipEntryWithData, readZipArchive, writeZipArchive } from "../documents/zip-archive";
import type { QuoteDocumentData, QuoteDocumentTaxLine } from "./document-data";
import { replaceWordXmlScalarTokens } from "./word-v2-renderer";

const VAT_SUMMARY_TOKEN = "PAPOT_VAT_SUMMARY";
const VAT_LINES_ANCHOR = "{{PAPOT_VAT_LINES_ANCHOR}}";
const WORD_TABLE_CELL_PATTERN = /<w:tc\b[\s\S]*?<\/w:tc>/g;

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

function formatMoneyCents(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

function formatVat(ratePercent: number): string {
  return `${percentFormatter.format(ratePercent)} %`;
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function findOpeningTagStart(xml: string, tagName: string, beforeIndex: number): number {
  const openingTagPattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>`, "g");
  let lastStart = -1;
  for (const match of xml.slice(0, beforeIndex + 1).matchAll(openingTagPattern)) {
    if (match.index !== undefined) lastStart = match.index;
  }
  return lastStart;
}

function cellProperties(cellXml: string): string {
  return cellXml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/)?.[0] ?? "";
}

function detailParagraph(value: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(value)}</w:t></w:r></w:p>`;
}

function detailRowXml(anchorRow: string, templateCell: string, taxLine: QuoteDocumentTaxLine): string {
  const rowProperties = anchorRow.match(/<w:trPr>[\s\S]*?<\/w:trPr>/)?.[0] ?? "";
  const label = `TVA ${formatVat(taxLine.ratePercent)} sur ${formatMoneyCents(taxLine.baseHtCents)} HT : ${formatMoneyCents(taxLine.vatCents)}`;
  return `<w:tr>${rowProperties}<w:tc>${cellProperties(templateCell)}${detailParagraph(label)}</w:tc></w:tr>`;
}

function sortedTaxLines(document: QuoteDocumentData): QuoteDocumentTaxLine[] {
  return [...document.totals.taxLines].sort((left, right) => left.ratePercent - right.ratePercent);
}

export function replaceQuoteVatAnchors(documentXml: string, document: QuoteDocumentData): string {
  const taxLines = sortedTaxLines(document);
  const summary =
    taxLines.length === 1
      ? `${formatVat(taxLines[0].ratePercent)} : ${formatMoneyCents(document.totals.totalVatCents)}`
      : formatMoneyCents(document.totals.totalVatCents);

  const summaryResult = replaceWordXmlScalarTokens(documentXml, {
    [VAT_SUMMARY_TOKEN]: summary,
  });
  if (summaryResult.replacementCounts.get(VAT_SUMMARY_TOKEN) !== 1) {
    throw new Error("QUOTE_WORD_V2_VAT_SUMMARY_ANCHOR_INVALID");
  }

  const xml = summaryResult.xml;
  const anchorIndex = xml.indexOf(VAT_LINES_ANCHOR);
  if (anchorIndex < 0) throw new Error("QUOTE_WORD_V2_VAT_LINES_ANCHOR_MISSING");
  if (xml.indexOf(VAT_LINES_ANCHOR, anchorIndex + VAT_LINES_ANCHOR.length) >= 0) {
    throw new Error("QUOTE_WORD_V2_VAT_LINES_ANCHOR_DUPLICATE");
  }

  const rowStart = findOpeningTagStart(xml, "w:tr", anchorIndex);
  const rowCloseStart = xml.indexOf("</w:tr>", anchorIndex);
  if (rowStart < 0 || rowCloseStart < 0) {
    throw new Error("QUOTE_WORD_V2_VAT_LINES_ROW_MISSING");
  }
  const rowEnd = rowCloseStart + "</w:tr>".length;

  if (taxLines.length <= 1) {
    return `${xml.slice(0, rowStart)}${xml.slice(rowEnd)}`;
  }

  const anchorRow = xml.slice(rowStart, rowEnd);
  const templateCells = Array.from(
    anchorRow.matchAll(WORD_TABLE_CELL_PATTERN),
    (match) => match[0],
  );
  if (templateCells.length !== 1) {
    throw new Error("QUOTE_WORD_V2_VAT_LINES_COLUMN_COUNT_INVALID");
  }

  const rows = taxLines.map((taxLine) => detailRowXml(anchorRow, templateCells[0], taxLine));
  return `${xml.slice(0, rowStart)}${rows.join("")}${xml.slice(rowEnd)}`;
}

export function renderQuoteWordV2VatSummary(
  template: Uint8Array,
  document: QuoteDocumentData,
): Uint8Array {
  const entries = readZipArchive(template);
  let documentXmlFound = false;

  const renderedEntries = entries.map((entry) => {
    if (entry.name !== "word/document.xml") return entry;
    documentXmlFound = true;
    const xml = Buffer.from(entry.data).toString("utf8");
    return cloneZipEntryWithData(entry, Buffer.from(replaceQuoteVatAnchors(xml, document), "utf8"));
  });

  if (!documentXmlFound) throw new Error("QUOTE_WORD_V2_DOCUMENT_XML_MISSING");
  return writeZipArchive(renderedEntries);
}
