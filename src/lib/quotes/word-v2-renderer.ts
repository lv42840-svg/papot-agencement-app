import { cloneZipEntryWithData, readZipArchive, writeZipArchive } from "../documents/zip-archive";
import type {
  QuoteDocumentData,
  QuoteDocumentItem,
  QuoteWordV2ScalarData,
} from "./document-data";
import type { QuoteRichTextRunStyle } from "./model";

const WORD_PARAGRAPH_PATTERN = /<w:p\b[\s\S]*?<\/w:p>/g;
const WORD_TEXT_PATTERN = /<w:t\b[^>]*>[\s\S]*?<\/w:t>/g;
const WORD_TABLE_ROW_PATTERN = /<w:tr\b[\s\S]*?<\/w:tr>/g;
const WORD_TABLE_CELL_PATTERN = /<w:tc\b[\s\S]*?<\/w:tc>/g;
const QUOTE_BODY_ANCHOR = "{{PAPOT_QUOTE_BODY}}";

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const quantityFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
});

const percentFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export type WordScalarReplacementResult = {
  xml: string;
  replacementCounts: ReadonlyMap<string, number>;
};

type WordTextNode = {
  textStart: number;
  textEnd: number;
  joinedStart: number;
  joinedEnd: number;
  text: string;
};

type ParagraphOptions = {
  align?: "left" | "center" | "right";
  bold?: boolean;
  italic?: boolean;
  keepNext?: boolean;
  fontSizePx?: number;
};

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wordTextNodes(paragraph: string): WordTextNode[] {
  const nodes: WordTextNode[] = [];
  let joinedOffset = 0;

  for (const match of paragraph.matchAll(WORD_TEXT_PATTERN)) {
    if (match.index === undefined) continue;
    const full = match[0];
    const openingEnd = full.indexOf(">");
    const closingStart = full.lastIndexOf("</w:t>");
    if (openingEnd < 0 || closingStart < 0) continue;

    const text = full.slice(openingEnd + 1, closingStart);
    const textStart = match.index + openingEnd + 1;
    const textEnd = match.index + closingStart;
    nodes.push({
      textStart,
      textEnd,
      joinedStart: joinedOffset,
      joinedEnd: joinedOffset + text.length,
      text,
    });
    joinedOffset += text.length;
  }

  return nodes;
}

function replaceFirstTokenInParagraph(
  paragraph: string,
  token: string,
  replacement: string,
): { paragraph: string; replaced: boolean } {
  const nodes = wordTextNodes(paragraph);
  const joinedText = nodes.map((node) => node.text).join("");
  const tokenStart = joinedText.indexOf(token);
  if (tokenStart < 0) return { paragraph, replaced: false };

  const tokenEnd = tokenStart + token.length;
  const escapedReplacement = escapeXmlText(replacement)
    .replaceAll("\r\n", "&#10;")
    .replaceAll("\n", "&#10;");
  let replacementInserted = false;
  const nodeReplacements: Array<{ start: number; end: number; text: string }> = [];

  for (const node of nodes) {
    const overlapStart = Math.max(tokenStart, node.joinedStart);
    const overlapEnd = Math.min(tokenEnd, node.joinedEnd);
    if (overlapStart >= overlapEnd) continue;

    const localStart = overlapStart - node.joinedStart;
    const localEnd = overlapEnd - node.joinedStart;
    const before = node.text.slice(0, localStart);
    const after = node.text.slice(localEnd);
    const inserted = replacementInserted ? "" : escapedReplacement;
    replacementInserted = true;

    nodeReplacements.push({
      start: node.textStart,
      end: node.textEnd,
      text: `${before}${inserted}${after}`,
    });
  }

  let next = paragraph;
  for (const nodeReplacement of nodeReplacements.reverse()) {
    next = `${next.slice(0, nodeReplacement.start)}${nodeReplacement.text}${next.slice(nodeReplacement.end)}`;
  }

  return { paragraph: next, replaced: true };
}

export function replaceWordXmlScalarTokens(
  xml: string,
  values: Readonly<Record<string, string>>,
): WordScalarReplacementResult {
  const replacementCounts = new Map<string, number>();
  for (const key of Object.keys(values)) replacementCounts.set(key, 0);

  const nextXml = xml.replace(WORD_PARAGRAPH_PATTERN, (originalParagraph) => {
    let paragraph = originalParagraph;

    for (const [key, value] of Object.entries(values)) {
      const token = `{{${key}}}`;
      let guard = 0;
      while (guard < 100) {
        const result = replaceFirstTokenInParagraph(paragraph, token, value);
        if (!result.replaced) break;
        paragraph = result.paragraph;
        replacementCounts.set(key, (replacementCounts.get(key) ?? 0) + 1);
        guard += 1;
      }
      if (guard >= 100) throw new Error(`QUOTE_WORD_V2_SCALAR_REPLACEMENT_LOOP:${key}`);
    }

    return paragraph;
  });

  return { xml: nextXml, replacementCounts };
}

function isWordXmlEntry(name: string): boolean {
  return name.startsWith("word/") && name.endsWith(".xml");
}

function formatMoneyCents(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

function formatMoneyEuros(euros: number): string {
  return moneyFormatter.format(euros);
}

function formatQuantity(quantity: number): string {
  return quantityFormatter.format(quantity);
}

function formatVat(ratePercent: number): string {
  return `${percentFormatter.format(ratePercent)} %`;
}

function wordHalfPointsFromPixels(fontSizePx: number): number {
  return Math.max(2, Math.round(fontSizePx * 1.5));
}

function hexWithoutHash(value: string): string {
  return value.replace(/^#/, "").toUpperCase();
}

function runProperties(
  style: QuoteRichTextRunStyle | null,
  defaults: ParagraphOptions,
): string {
  const properties: string[] = [];
  const bold = style ? style.bold : (defaults.bold ?? false);
  const italic = style ? style.italic : (defaults.italic ?? false);
  const fontSizePx = style?.fontSizePx ?? defaults.fontSizePx ?? null;

  if (bold) properties.push("<w:b/>");
  if (italic) properties.push("<w:i/>");
  if (style?.underline) properties.push('<w:u w:val="single"/>');
  if (style?.textColor) properties.push(`<w:color w:val="${hexWithoutHash(style.textColor)}"/>`);
  if (style?.highlightColor) {
    properties.push(
      `<w:shd w:val="clear" w:color="auto" w:fill="${hexWithoutHash(style.highlightColor)}"/>`,
    );
  }
  if (fontSizePx !== null) {
    const halfPoints = wordHalfPointsFromPixels(fontSizePx);
    properties.push(`<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>`);
  }

  return properties.length > 0 ? `<w:rPr>${properties.join("")}</w:rPr>` : "";
}

function textToWordRuns(text: string, properties: string): string {
  const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const parts = normalized.split("\n");
  const runs: string[] = [];

  parts.forEach((part, index) => {
    if (part.length > 0) {
      runs.push(`<w:r>${properties}<w:t xml:space="preserve">${escapeXmlText(part)}</w:t></w:r>`);
    }
    if (index < parts.length - 1) runs.push(`<w:r>${properties}<w:br/></w:r>`);
  });

  if (runs.length === 0) runs.push(`<w:r>${properties}<w:t></w:t></w:r>`);
  return runs.join("");
}

function itemWordRuns(item: QuoteDocumentItem, defaults: ParagraphOptions): string {
  const richText = item.richText;
  if (!richText || richText.runs.length === 0) {
    return textToWordRuns(item.text, runProperties(null, defaults));
  }

  return richText.runs
    .map((run) => textToWordRuns(run.text, runProperties(run.style, defaults)))
    .join("");
}

function paragraphXml(runs: string, options: ParagraphOptions = {}): string {
  const paragraphProperties: string[] = [];
  if (options.align) paragraphProperties.push(`<w:jc w:val="${options.align}"/>`);
  if (options.keepNext) paragraphProperties.push("<w:keepNext/><w:keepLines/>");
  const pPr =
    paragraphProperties.length > 0 ? `<w:pPr>${paragraphProperties.join("")}</w:pPr>` : "";
  return `<w:p>${pPr}${runs}</w:p>`;
}

function plainParagraphXml(value: string, options: ParagraphOptions = {}): string {
  return paragraphXml(textToWordRuns(value, runProperties(null, options)), options);
}

function cellProperties(cellXml: string): string {
  return cellXml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/)?.[0] ?? "";
}

function makeCell(templateCell: string, paragraph: string): string {
  return `<w:tc>${cellProperties(templateCell)}${paragraph}</w:tc>`;
}

function visibleBodyItemIds(items: QuoteDocumentItem[]): Set<string> {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const visible = new Set<string>();
  const leafItems = items.filter(
    (item) =>
      (item.kind === "LINE" || item.kind === "COMMENT") &&
      (item.scope === "MAIN" || item.scope === "RETAINED_OPTION"),
  );

  for (const leaf of leafItems) {
    visible.add(leaf.id);
    let parentId = leaf.parentId;
    let guard = 0;
    while (parentId && guard < 100) {
      const parent = itemById.get(parentId);
      if (!parent) break;
      if (parent.scope === "MAIN" || parent.scope === "RETAINED_OPTION") visible.add(parent.id);
      parentId = parent.parentId;
      guard += 1;
    }
  }

  return visible;
}

function bodyRowXml(
  anchorRow: string,
  templateCells: readonly string[],
  item: QuoteDocumentItem,
): string {
  const rowProperties = anchorRow.match(/<w:trPr>[\s\S]*?<\/w:trPr>/)?.[0] ?? "";
  const cells = Array.from({ length: 6 }, (_, index) => templateCells[index]);
  if (cells.some((cell) => !cell)) throw new Error("QUOTE_WORD_V2_BODY_TEMPLATE_CELL_MISSING");

  const isHeading = item.kind === "SECTION" || item.kind === "SUBSECTION";
  const headingFontSize = item.kind === "SECTION" ? 16 : 13;
  const numberParagraph = plainParagraphXml(item.number, {
    align: isHeading ? "left" : "center",
    bold: isHeading,
    fontSizePx: isHeading ? headingFontSize : undefined,
    keepNext: isHeading,
  });
  const descriptionParagraph = paragraphXml(
    itemWordRuns(item, {
      bold: isHeading,
      fontSizePx: isHeading ? headingFontSize : undefined,
      keepNext: isHeading,
    }),
    { keepNext: isHeading },
  );

  const renderedCells = [
    makeCell(cells[0], numberParagraph),
    makeCell(cells[1], descriptionParagraph),
    makeCell(
      cells[2],
      item.kind === "LINE"
        ? plainParagraphXml(formatQuantity(item.quantity ?? 0), { align: "right" })
        : plainParagraphXml(""),
    ),
    makeCell(
      cells[3],
      item.kind === "LINE" && item.unitPriceHt !== null
        ? plainParagraphXml(formatMoneyEuros(item.unitPriceHt), { align: "right" })
        : plainParagraphXml(""),
    ),
    makeCell(
      cells[4],
      item.kind === "LINE" && item.vatRatePercent !== null
        ? plainParagraphXml(formatVat(item.vatRatePercent), { align: "center" })
        : plainParagraphXml(""),
    ),
    makeCell(
      cells[5],
      item.kind === "LINE" && item.totalHtCents !== null
        ? plainParagraphXml(formatMoneyCents(item.totalHtCents), { align: "right" })
        : plainParagraphXml(""),
    ),
  ];

  return `<w:tr>${rowProperties}${renderedCells.join("")}</w:tr>`;
}

export function replaceQuoteBodyAnchor(
  documentXml: string,
  document: QuoteDocumentData,
): string {
  const anchorIndex = documentXml.indexOf(QUOTE_BODY_ANCHOR);
  if (anchorIndex < 0) throw new Error("QUOTE_WORD_V2_BODY_ANCHOR_MISSING");
  if (documentXml.indexOf(QUOTE_BODY_ANCHOR, anchorIndex + QUOTE_BODY_ANCHOR.length) >= 0) {
    throw new Error("QUOTE_WORD_V2_BODY_ANCHOR_DUPLICATE");
  }

  const rowStart = documentXml.lastIndexOf("<w:tr", anchorIndex);
  const rowCloseStart = documentXml.indexOf("</w:tr>", anchorIndex);
  if (rowStart < 0 || rowCloseStart < 0) throw new Error("QUOTE_WORD_V2_BODY_ROW_MISSING");
  const rowEnd = rowCloseStart + "</w:tr>".length;
  const anchorRow = documentXml.slice(rowStart, rowEnd);
  const templateCells = Array.from(anchorRow.matchAll(WORD_TABLE_CELL_PATTERN), (match) => match[0]);
  if (templateCells.length !== 6) throw new Error("QUOTE_WORD_V2_BODY_COLUMN_COUNT_INVALID");

  const visibleIds = visibleBodyItemIds(document.items);
  const rows = document.items
    .filter((item) => visibleIds.has(item.id))
    .map((item) => bodyRowXml(anchorRow, templateCells, item))
    .join("");

  return `${documentXml.slice(0, rowStart)}${rows}${documentXml.slice(rowEnd)}`;
}

export function renderQuoteWordV2Body(template: Uint8Array, document: QuoteDocumentData): Uint8Array {
  const entries = readZipArchive(template);
  let documentXmlFound = false;

  const renderedEntries = entries.map((entry) => {
    if (entry.name !== "word/document.xml") return entry;
    documentXmlFound = true;
    const xml = Buffer.from(entry.data).toString("utf8");
    return cloneZipEntryWithData(entry, Buffer.from(replaceQuoteBodyAnchor(xml, document), "utf8"));
  });

  if (!documentXmlFound) throw new Error("QUOTE_WORD_V2_DOCUMENT_XML_MISSING");
  return writeZipArchive(renderedEntries);
}

export function renderQuoteWordV2Scalars(
  template: Uint8Array,
  scalarData: QuoteWordV2ScalarData,
): Uint8Array {
  const entries = readZipArchive(template);
  const totalReplacementCounts = new Map<string, number>();
  for (const key of Object.keys(scalarData)) totalReplacementCounts.set(key, 0);

  const renderedEntries = entries.map((entry) => {
    if (!isWordXmlEntry(entry.name)) return entry;

    const xml = Buffer.from(entry.data).toString("utf8");
    const rendered = replaceWordXmlScalarTokens(
      xml,
      scalarData as unknown as Readonly<Record<string, string>>,
    );
    for (const [key, count] of rendered.replacementCounts) {
      totalReplacementCounts.set(key, (totalReplacementCounts.get(key) ?? 0) + count);
    }
    return cloneZipEntryWithData(entry, Buffer.from(rendered.xml, "utf8"));
  });

  for (const [key, count] of totalReplacementCounts) {
    if (count === 0) throw new Error(`QUOTE_WORD_V2_SCALAR_TOKEN_MISSING:${key}`);
  }

  return writeZipArchive(renderedEntries);
}
