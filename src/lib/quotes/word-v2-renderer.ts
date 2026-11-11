import { cloneZipEntryWithData, readZipArchive, writeZipArchive } from "../documents/zip-archive";
import type { QuoteDocumentData, QuoteDocumentItem, QuoteWordV2ScalarData } from "./document-data";
import type { QuoteRichTextRunStyle } from "./model";

const WORD_PARAGRAPH_PATTERN = /<w:p\b[\s\S]*?<\/w:p>/g;
const WORD_TEXT_PATTERN = /<w:t\b[^>]*>[\s\S]*?<\/w:t>/g;
const WORD_TABLE_CELL_PATTERN = /<w:tc\b[\s\S]*?<\/w:tc>/g;
const QUOTE_BODY_ANCHOR = "{{PAPOT_QUOTE_BODY}}";
const QUOTE_OPTIONS_ANCHOR = "{{PAPOT_OPTIONS_BLOCK}}";

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

function escapeXmlText(valeur: string): string {
  return valeur
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function wordTextNodes(paragraph: string): WordTextNode[] {
  const nodes: WordTextNode[] = [];
  let joinedOffset = 0;

  for (const correspondance of paragraph.matchAll(WORD_TEXT_PATTERN)) {
    if (correspondance.index === undefined) continue;
    const full = correspondance[0];
    const openingEnd = full.indexOf(">");
    const closingStart = full.lastIndexOf("</w:t>");
    if (openingEnd < 0 || closingStart < 0) continue;

    const texte = full.slice(openingEnd + 1, closingStart);
    const textStart = correspondance.index + openingEnd + 1;
    const textEnd = correspondance.index + closingStart;
    nodes.push({
      textStart,
      textEnd,
      joinedStart: joinedOffset,
      joinedEnd: joinedOffset + texte.length,
      text: texte,
    });
    joinedOffset += texte.length;
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

  let suivant = paragraph;
  for (const nodeReplacement of nodeReplacements.reverse()) {
    suivant = `${suivant.slice(0, nodeReplacement.start)}${nodeReplacement.text}${suivant.slice(nodeReplacement.end)}`;
  }

  return { paragraph: suivant, replaced: true };
}

export function replaceWordXmlScalarTokens(
  xml: string,
  valeurs: Readonly<Record<string, string>>,
): WordScalarReplacementResult {
  const replacementCounts = new Map<string, number>();
  for (const cle of Object.keys(valeurs)) replacementCounts.set(cle, 0);

  const nextXml = xml.replace(WORD_PARAGRAPH_PATTERN, (originalParagraph) => {
    let paragraph = originalParagraph;

    for (const [cle, valeur] of Object.entries(valeurs)) {
      const token = `{{${cle}}}`;
      let guard = 0;
      while (guard < 100) {
        const resultat = replaceFirstTokenInParagraph(paragraph, token, valeur);
        if (!resultat.replaced) break;
        paragraph = resultat.paragraph;
        replacementCounts.set(cle, (replacementCounts.get(cle) ?? 0) + 1);
        guard += 1;
      }
      if (guard >= 100) throw new Error(`QUOTE_WORD_V2_SCALAR_REPLACEMENT_LOOP:${cle}`);
    }

    return paragraph;
  });

  return { xml: nextXml, replacementCounts };
}

function isWordXmlEntry(nom: string): boolean {
  return nom.startsWith("word/") && nom.endsWith(".xml");
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

function hexWithoutHash(valeur: string): string {
  return valeur.replace(/^#/, "").toUpperCase();
}

function runProperties(style: QuoteRichTextRunStyle | null, defaults: ParagraphOptions): string {
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

function textToWordRuns(texte: string, properties: string): string {
  const normalized = texte.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const parts = normalized.split("\n");
  const runs: string[] = [];

  parts.forEach((part, indice) => {
    if (part.length > 0) {
      runs.push(`<w:r>${properties}<w:t xml:space="preserve">${escapeXmlText(part)}</w:t></w:r>`);
    }
    if (indice < parts.length - 1) runs.push(`<w:r>${properties}<w:br/></w:r>`);
  });

  if (runs.length === 0) runs.push(`<w:r>${properties}<w:t></w:t></w:r>`);
  return runs.join("");
}

function itemWordRuns(element: QuoteDocumentItem, defaults: ParagraphOptions): string {
  const richText = element.richText;
  if (!richText || richText.runs.length === 0) {
    return textToWordRuns(element.text, runProperties(null, defaults));
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

function plainParagraphXml(valeur: string, options: ParagraphOptions = {}): string {
  return paragraphXml(textToWordRuns(valeur, runProperties(null, options)), options);
}

function cellProperties(cellXml: string): string {
  return cellXml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/)?.[0] ?? "";
}

function addBottomBorderToCellProperties(properties: string): string {
  const bas = '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>';
  if (/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/.test(properties)) {
    return properties.replace(
      /<w:tcBorders>([\s\S]*?)<\/w:tcBorders>/,
      (_match, corps: string) =>
        `<w:tcBorders>${corps.replace(/<w:bottom\b[^>]*\/>/, "")}${bas}</w:tcBorders>`,
    );
  }
  return properties.replace("</w:tcPr>", `<w:tcBorders>${bas}</w:tcBorders></w:tcPr>`);
}

function addCellShadingToProperties(properties: string, fill: string): string {
  const shading = `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;
  if (/<w:shd\b[^>]*\/>/.test(properties)) {
    return properties.replace(/<w:shd\b[^>]*\/>/, shading);
  }
  return properties.replace("</w:tcPr>", `${shading}</w:tcPr>`);
}

type CellRenderOptions = {
  bottomBorder?: boolean;
  fill?: string;
  noWrap?: boolean;
  width?: number;
};

function addNoWrapToCellProperties(properties: string): string {
  if (/<w:noWrap\b[^>]*\/>/.test(properties)) return properties;
  return properties.replace("</w:tcPr>", "<w:noWrap/></w:tcPr>");
}

function makeCell(
  templateCell: string,
  paragraph: string,
  options: CellRenderOptions = {},
): string {
  let properties = cellProperties(templateCell);
  if (options.bottomBorder) properties = addBottomBorderToCellProperties(properties);
  if (options.fill) properties = addCellShadingToProperties(properties, options.fill);
  if (options.noWrap) properties = addNoWrapToCellProperties(properties);
  const cell = `<w:tc>${properties}${paragraph}</w:tc>`;
  return options.width === undefined ? cell : setCellWidth(cell, options.width);
}

function findOpeningTagStart(xml: string, tagName: string, beforeIndex: number): number {
  const openingTagPattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>`, "g");
  let lastStart = -1;
  for (const correspondance of xml.slice(0, beforeIndex + 1).matchAll(openingTagPattern)) {
    if (correspondance.index !== undefined) lastStart = correspondance.index;
  }
  return lastStart;
}

const QUOTE_TABLE_WIDTHS = [850, 4933, 1134, 1417, 1077, 1587] as const;
const QUOTE_TABLE_TOTAL_WIDTH = QUOTE_TABLE_WIDTHS.reduce((somme, width) => somme + width, 0);
const FINANCIAL_TABLE_WIDTHS = [6314, 4572] as const;
const FINANCIAL_TABLE_TOTAL_WIDTH = FINANCIAL_TABLE_WIDTHS.reduce(
  (somme, width) => somme + width,
  0,
);
const FINANCIAL_TOTALS_WIDTHS = [2900, 1672] as const;

function paragraphVisibleText(paragraph: string): string {
  return wordTextNodes(paragraph)
    .map((node) => node.text)
    .join("")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .trim();
}

function tableRangeAroundAnchor(
  xml: string,
  anchor: string,
): { start: number; end: number; table: string } {
  const anchorIndex = xml.indexOf(anchor);
  if (anchorIndex < 0) throw new Error(`QUOTE_WORD_V2_LAYOUT_ANCHOR_MISSING:${anchor}`);
  const debut = findOpeningTagStart(xml, "w:tbl", anchorIndex);
  const closeStart = xml.indexOf("</w:tbl>", anchorIndex);
  if (debut < 0 || closeStart < 0) {
    throw new Error(`QUOTE_WORD_V2_LAYOUT_TABLE_MISSING:${anchor}`);
  }
  const fin = closeStart + "</w:tbl>".length;
  return { start: debut, end: fin, table: xml.slice(debut, fin) };
}

function fixedTableGrid(widths: readonly number[]): string {
  return `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`;
}

function normalizeTableProperties(
  table: string,
  widths: readonly number[],
  options: { removeRepeatingHeader?: boolean } = {},
): string {
  const totalWidth = widths.reduce((somme, width) => somme + width, 0);
  let suivant = table.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/, fixedTableGrid(widths));

  suivant = suivant.replace(/<w:tblPr>([\s\S]*?)<\/w:tblPr>/, (_match, corps: string) => {
    let properties = corps;
    if (/<w:tblW\b[^>]*\/>/.test(properties)) {
      properties = properties.replace(
        /<w:tblW\b[^>]*\/>/,
        `<w:tblW w:w="${totalWidth}" w:type="dxa"/>`,
      );
    } else {
      properties = `<w:tblW w:w="${totalWidth}" w:type="dxa"/>${properties}`;
    }
    if (/<w:tblLayout\b[^>]*\/>/.test(properties)) {
      properties = properties.replace(/<w:tblLayout\b[^>]*\/>/, '<w:tblLayout w:type="fixed"/>');
    } else {
      properties += '<w:tblLayout w:type="fixed"/>';
    }
    return `<w:tblPr>${properties}</w:tblPr>`;
  });

  if (options.removeRepeatingHeader) {
    suivant = suivant.replace(/<w:tblHeader\b[^>]*\/?\s*>/g, "");
  }
  return suivant;
}

function replaceTableAroundAnchor(
  xml: string,
  anchor: string,
  transform: (table: string) => string,
): string {
  const range = tableRangeAroundAnchor(xml, anchor);
  return `${xml.slice(0, range.start)}${transform(range.table)}${xml.slice(range.end)}`;
}

function matchingTagRangeFromStart(
  xml: string,
  tagName: string,
  debut: number,
): { start: number; end: number; xml: string } | null {
  const pattern = new RegExp(`<(/?)${tagName}\\b[^>]*?(\\/?)>`, "g");
  pattern.lastIndex = debut;
  let depth = 0;
  let correspondance: RegExpExecArray | null;

  while ((correspondance = pattern.exec(xml)) !== null) {
    const closing = correspondance[1] === "/";
    const selfClosing = correspondance[2] === "/";
    if (!closing && !selfClosing) {
      depth += 1;
      continue;
    }
    if (!closing) continue;
    depth -= 1;
    if (depth === 0) {
      return { start: debut, end: pattern.lastIndex, xml: xml.slice(debut, pattern.lastIndex) };
    }
  }
  return null;
}

function containingTableWithTexts(
  xml: string,
  anchor: string,
  requiredTexts: readonly string[],
): { start: number; end: number; table: string } {
  const anchorIndex = xml.indexOf(anchor);
  if (anchorIndex < 0) throw new Error(`QUOTE_WORD_V2_LAYOUT_ANCHOR_MISSING:${anchor}`);

  const openingPattern = /<w:tbl(?:\s[^>]*)?>/g;
  const starts = Array.from(xml.slice(0, anchorIndex + 1).matchAll(openingPattern))
    .map((correspondance) => correspondance.index)
    .filter((indice): indice is number => indice !== undefined)
    .reverse();

  for (const debut of starts) {
    const range = matchingTagRangeFromStart(xml, "w:tbl", debut);
    if (!range || range.end <= anchorIndex) continue;
    if (requiredTexts.every((texte) => range.xml.includes(texte))) {
      return { start: range.start, end: range.end, table: range.xml };
    }
  }

  throw new Error("QUOTE_WORD_V2_LAYOUT_PARENT_TABLE_MISSING");
}

function replaceFinancialTable(documentXml: string): string {
  const range = containingTableWithTexts(documentXml, "{{total_ht}}", ["Pour le client"]);
  return `${documentXml.slice(0, range.start)}${splitFinancialSignature(range.table)}${documentXml.slice(range.end)}`;
}

function setCellWidth(cell: string, width: number): string {
  return cell.replace(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/, (_match, corps: string) => {
    let properties = corps;
    if (/<w:tcW\b[^>]*\/>/.test(properties)) {
      properties = properties.replace(/<w:tcW\b[^>]*\/>/, `<w:tcW w:w="${width}" w:type="dxa"/>`);
    } else {
      properties = `<w:tcW w:w="${width}" w:type="dxa"/>${properties}`;
    }
    return `<w:tcPr>${properties}</w:tcPr>`;
  });
}

type DirectTagRange = { start: number; end: number };

function directTagRanges(xml: string, tagName: string): DirectTagRange[] {
  const pattern = new RegExp(`<(/?)${tagName}\\b[^>]*?(\\/?)>`, "g");
  const ranges: DirectTagRange[] = [];
  let depth = 0;
  let directStart = -1;
  let correspondance: RegExpExecArray | null;

  while ((correspondance = pattern.exec(xml)) !== null) {
    const closing = correspondance[1] === "/";
    const selfClosing = correspondance[2] === "/";

    if (!closing && !selfClosing) {
      depth += 1;
      if (depth === 1) directStart = correspondance.index;
      continue;
    }

    if (closing) {
      if (depth === 1 && directStart >= 0) {
        ranges.push({ start: directStart, end: pattern.lastIndex });
        directStart = -1;
      }
      depth -= 1;
    }
  }

  return ranges;
}

function normalizeTwoColumnTable(table: string, widths: readonly [number, number]): string {
  let suivant = normalizeTableProperties(table, widths).replace(/<w:tblInd\b[^>]*\/>/g, "");
  const lignesTableau = directTagRanges(suivant, "w:tr").reverse();

  for (const rowRange of lignesTableau) {
    let ligneTableau = suivant.slice(rowRange.start, rowRange.end);
    const cells = directTagRanges(ligneTableau, "w:tc");
    if (cells.length !== 2) continue;

    for (let indice = cells.length - 1; indice >= 0; indice -= 1) {
      const cellRange = cells[indice]!;
      const cell = ligneTableau.slice(cellRange.start, cellRange.end);
      ligneTableau =
        ligneTableau.slice(0, cellRange.start) +
        setCellWidth(cell, widths[indice]!) +
        ligneTableau.slice(cellRange.end);
    }

    suivant = suivant.slice(0, rowRange.start) + ligneTableau + suivant.slice(rowRange.end);
  }

  return suivant;
}

function normalizeFinancialTotalsContent(content: string): string {
  const range = tableRangeAroundAnchor(content, "{{total_ht}}");
  const normalized = normalizeTwoColumnTable(range.table, FINANCIAL_TOTALS_WIDTHS);
  return `${content.slice(0, range.start)}${normalized}${content.slice(range.end)}`;
}

function splitFinancialSignature(table: string): string {
  const rowRange = directTagRanges(table, "w:tr").find((range) =>
    table.slice(range.start, range.end).includes("{{total_ht}}"),
  );
  if (!rowRange) {
    throw new Error("QUOTE_WORD_V2_LAYOUT_FINANCIAL_ROW_MISSING");
  }

  const ligneTableau = table.slice(rowRange.start, rowRange.end);
  const cellRanges = directTagRanges(ligneTableau, "w:tc");
  if (cellRanges.length !== 2) {
    throw new Error("QUOTE_WORD_V2_LAYOUT_FINANCIAL_CELL_COUNT_INVALID");
  }

  const cells = cellRanges.map((range) => ligneTableau.slice(range.start, range.end));
  const droite = cells[1]!;
  const signatureTextIndex = droite.indexOf("Pour le client");
  if (signatureTextIndex < 0) {
    throw new Error("QUOTE_WORD_V2_LAYOUT_SIGNATURE_MISSING");
  }
  const signatureStart = findOpeningTagStart(droite, "w:p", signatureTextIndex);
  if (signatureStart < 0) {
    throw new Error("QUOTE_WORD_V2_LAYOUT_SIGNATURE_PARAGRAPH_MISSING");
  }

  const rightTcPr = cellProperties(droite);
  const contentStart = droite.indexOf(rightTcPr) + rightTcPr.length;
  const contentEnd = droite.lastIndexOf("</w:tc>");
  const beforeSignature = normalizeFinancialTotalsContent(
    droite.slice(contentStart, signatureStart),
  );
  const signatureContent = droite.slice(signatureStart, contentEnd);

  const leftCell = setCellWidth(cells[0]!, FINANCIAL_TABLE_WIDTHS[0]);
  const rightCell = setCellWidth(
    `<w:tc>${rightTcPr}${beforeSignature}</w:tc>`,
    FINANCIAL_TABLE_WIDTHS[1],
  );
  const rowProperties = ligneTableau.match(/<w:trPr>[\s\S]*?<\/w:trPr>/)?.[0] ?? "";
  const financialRow = `<w:tr>${rowProperties}${leftCell}${rightCell}</w:tr>`;
  const signatureRow =
    `<w:tr><w:tc><w:tcPr><w:tcW w:w="${FINANCIAL_TABLE_TOTAL_WIDTH}" w:type="dxa"/>` +
    '<w:gridSpan w:val="2"/></w:tcPr>' +
    `${signatureContent}</w:tc></w:tr>`;

  let suivant = `${table.slice(0, rowRange.start)}${financialRow}${signatureRow}${table.slice(rowRange.end)}`;
  suivant = normalizeTableProperties(suivant, FINANCIAL_TABLE_WIDTHS);
  return suivant;
}

export function replaceQuoteWordV2Layout(documentXml: string): string {
  let suivant = documentXml.replace(WORD_PARAGRAPH_PATTERN, (paragraph) =>
    paragraphVisibleText(paragraph) === "OPTIONS NON COMPRISES DANS LE TOTAL PRINCIPAL"
      ? ""
      : paragraph,
  );

  suivant = replaceTableAroundAnchor(suivant, QUOTE_BODY_ANCHOR, (table) =>
    normalizeTableProperties(table, QUOTE_TABLE_WIDTHS),
  );
  suivant = replaceTableAroundAnchor(suivant, QUOTE_OPTIONS_ANCHOR, (table) =>
    normalizeTableProperties(table, QUOTE_TABLE_WIDTHS, { removeRepeatingHeader: true }),
  );
  suivant = replaceFinancialTable(suivant);
  return suivant;
}

export function renderQuoteWordV2Layout(template: Uint8Array): Uint8Array {
  return renderDocumentXml(
    template,
    replaceQuoteWordV2Layout,
    "QUOTE_WORD_V2_DOCUMENT_XML_MISSING",
  );
}

function visibleBodyItemIds(elements: QuoteDocumentItem[]): Set<string> {
  const itemById = new Map(elements.map((element) => [element.id, element]));
  const visible = new Set<string>();
  const leafItems = elements.filter(
    (element) =>
      (element.kind === "LINE" || element.kind === "COMMENT") &&
      (element.scope === "MAIN" || element.scope === "RETAINED_OPTION"),
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
  element: QuoteDocumentItem,
  options: { bottomBorder?: boolean } = {},
): string {
  const rowProperties = anchorRow.match(/<w:trPr>[\s\S]*?<\/w:trPr>/)?.[0] ?? "";
  const cells = Array.from({ length: 6 }, (_, indice) => templateCells[indice]);
  if (cells.some((cell) => !cell)) throw new Error("QUOTE_WORD_V2_BODY_TEMPLATE_CELL_MISSING");

  const isHeading = element.kind === "SECTION" || element.kind === "SUBSECTION";
  const headingFontSize = element.kind === "SECTION" ? 16 : 13;
  const headingFill =
    element.kind === "SECTION" ? "E9E2F7" : element.kind === "SUBSECTION" ? "F5F1FB" : undefined;
  const cellOptions: CellRenderOptions = { ...options, fill: headingFill };
  const numberParagraph = plainParagraphXml(element.number, {
    align: "left",
    bold: isHeading,
    fontSizePx: isHeading ? headingFontSize : undefined,
    keepNext: isHeading,
  });
  const descriptionParagraph = paragraphXml(
    itemWordRuns(element, {
      bold: isHeading,
      fontSizePx: isHeading ? headingFontSize : undefined,
      keepNext: isHeading,
    }),
    { keepNext: isHeading },
  );

  const renderedCells = [
    makeCell(cells[0], numberParagraph, {
      ...cellOptions,
      noWrap: true,
      width: QUOTE_TABLE_WIDTHS[0],
    }),
    makeCell(cells[1], descriptionParagraph, {
      ...cellOptions,
      width: QUOTE_TABLE_WIDTHS[1],
    }),
    makeCell(
      cells[2],
      element.kind === "LINE"
        ? plainParagraphXml(formatQuantity(element.quantity ?? 0), { align: "right" })
        : plainParagraphXml(""),
      { ...cellOptions, width: QUOTE_TABLE_WIDTHS[2] },
    ),
    makeCell(
      cells[3],
      element.kind === "LINE" && element.unitPriceHt !== null
        ? plainParagraphXml(formatMoneyEuros(element.unitPriceHt), { align: "right" })
        : plainParagraphXml(""),
      { ...cellOptions, width: QUOTE_TABLE_WIDTHS[3] },
    ),
    makeCell(
      cells[4],
      element.kind === "LINE" && element.vatRatePercent !== null
        ? plainParagraphXml(formatVat(element.vatRatePercent), { align: "center" })
        : plainParagraphXml(""),
      { ...cellOptions, width: QUOTE_TABLE_WIDTHS[4] },
    ),
    makeCell(
      cells[5],
      element.totalHtCents !== null
        ? plainParagraphXml(formatMoneyCents(element.totalHtCents), {
            align: "right",
            bold: isHeading,
          })
        : plainParagraphXml(""),
      { ...cellOptions, width: QUOTE_TABLE_WIDTHS[5] },
    ),
  ];

  return `<w:tr>${rowProperties}${renderedCells.join("")}</w:tr>`;
}

function simpleSixColumnRowXml(
  anchorRow: string,
  templateCells: readonly string[],
  designation: string,
  total: string,
  options: { bold?: boolean; fontSizePx?: number; keepNext?: boolean } = {},
): string {
  const rowProperties = anchorRow.match(/<w:trPr>[\s\S]*?<\/w:trPr>/)?.[0] ?? "";
  const cells = Array.from({ length: 6 }, (_, indice) => templateCells[indice]);
  if (cells.some((cell) => !cell)) {
    throw new Error("QUOTE_WORD_V2_OPTIONS_TEMPLATE_CELL_MISSING");
  }

  return `<w:tr>${rowProperties}${[
    makeCell(cells[0], plainParagraphXml("")),
    makeCell(
      cells[1],
      plainParagraphXml(designation, {
        bold: options.bold,
        fontSizePx: options.fontSizePx,
        keepNext: options.keepNext,
      }),
    ),
    makeCell(cells[2], plainParagraphXml("")),
    makeCell(cells[3], plainParagraphXml("")),
    makeCell(cells[4], plainParagraphXml("")),
    makeCell(
      cells[5],
      plainParagraphXml(total, {
        align: "right",
        bold: options.bold,
      }),
    ),
  ].join("")}</w:tr>`;
}

export function replaceQuoteBodyAnchor(documentXml: string, document: QuoteDocumentData): string {
  const anchorIndex = documentXml.indexOf(QUOTE_BODY_ANCHOR);
  if (anchorIndex < 0) throw new Error("QUOTE_WORD_V2_BODY_ANCHOR_MISSING");
  if (documentXml.indexOf(QUOTE_BODY_ANCHOR, anchorIndex + QUOTE_BODY_ANCHOR.length) >= 0) {
    throw new Error("QUOTE_WORD_V2_BODY_ANCHOR_DUPLICATE");
  }

  const rowStart = findOpeningTagStart(documentXml, "w:tr", anchorIndex);
  const rowCloseStart = documentXml.indexOf("</w:tr>", anchorIndex);
  if (rowStart < 0 || rowCloseStart < 0) throw new Error("QUOTE_WORD_V2_BODY_ROW_MISSING");
  const rowEnd = rowCloseStart + "</w:tr>".length;
  const anchorRow = documentXml.slice(rowStart, rowEnd);
  const templateCells = Array.from(
    anchorRow.matchAll(WORD_TABLE_CELL_PATTERN),
    (correspondance) => correspondance[0],
  );
  if (templateCells.length !== 6) throw new Error("QUOTE_WORD_V2_BODY_COLUMN_COUNT_INVALID");

  const visibleIds = visibleBodyItemIds(document.items);
  const lignesTableau = document.items
    .filter((element) => visibleIds.has(element.id))
    .map((element) => bodyRowXml(anchorRow, templateCells, element))
    .join("");

  return `${documentXml.slice(0, rowStart)}${lignesTableau}${documentXml.slice(rowEnd)}`;
}

export function replaceQuoteOptionsAnchor(
  documentXml: string,
  document: QuoteDocumentData,
): string {
  const anchorIndex = documentXml.indexOf(QUOTE_OPTIONS_ANCHOR);
  if (anchorIndex < 0) throw new Error("QUOTE_WORD_V2_OPTIONS_ANCHOR_MISSING");
  if (documentXml.indexOf(QUOTE_OPTIONS_ANCHOR, anchorIndex + QUOTE_OPTIONS_ANCHOR.length) >= 0) {
    throw new Error("QUOTE_WORD_V2_OPTIONS_ANCHOR_DUPLICATE");
  }

  const tableStart = findOpeningTagStart(documentXml, "w:tbl", anchorIndex);
  const tableCloseStart = documentXml.indexOf("</w:tbl>", anchorIndex);
  if (tableStart < 0 || tableCloseStart < 0) {
    throw new Error("QUOTE_WORD_V2_OPTIONS_TABLE_MISSING");
  }
  const tableEnd = tableCloseStart + "</w:tbl>".length;

  if (document.pendingOptions.length === 0) {
    return `${documentXml.slice(0, tableStart)}${documentXml.slice(tableEnd)}`;
  }

  const rowStart = findOpeningTagStart(documentXml, "w:tr", anchorIndex);
  const rowCloseStart = documentXml.indexOf("</w:tr>", anchorIndex);
  if (rowStart < tableStart || rowCloseStart < 0 || rowCloseStart > tableCloseStart) {
    throw new Error("QUOTE_WORD_V2_OPTIONS_ROW_MISSING");
  }
  const rowEnd = rowCloseStart + "</w:tr>".length;
  const anchorRow = documentXml.slice(rowStart, rowEnd);
  const templateCells = Array.from(
    anchorRow.matchAll(WORD_TABLE_CELL_PATTERN),
    (correspondance) => correspondance[0],
  );
  if (templateCells.length !== 6) {
    throw new Error("QUOTE_WORD_V2_OPTIONS_COLUMN_COUNT_INVALID");
  }

  const lignesTableau: string[] = [
    simpleSixColumnRowXml(
      anchorRow,
      templateCells,
      "OPTIONS NON COMPRISES DANS LE TOTAL DU DEVIS",
      "",
      { bold: true, fontSizePx: 14, keepNext: true },
    ),
  ];

  for (const option of document.pendingOptions) {
    lignesTableau.push(
      simpleSixColumnRowXml(anchorRow, templateCells, option.label, "", {
        bold: true,
        fontSizePx: 12,
        keepNext: true,
      }),
    );

    const optionItems = document.items.filter(
      (element) => element.scope === "PENDING_OPTION" && element.optionId === option.id,
    );
    for (const element of optionItems) {
      lignesTableau.push(bodyRowXml(anchorRow, templateCells, element, { bottomBorder: true }));
    }
  }

  return `${documentXml.slice(0, rowStart)}${lignesTableau.join("")}${documentXml.slice(rowEnd)}`;
}

function replaceQuoteCustomerDiscountRow(documentXml: string, document: QuoteDocumentData): string {
  const discountCents = document.totals.customerDiscountCents ?? 0;
  if (discountCents <= 0 || !document.totals.customerDiscountLabel) return documentXml;

  const range = tableRangeAroundAnchor(documentXml, "{{total_ht}}");
  const rowRange = directTagRanges(range.table, "w:tr").find((candidat) =>
    range.table.slice(candidat.start, candidat.end).includes("{{total_ht}}"),
  );
  if (!rowRange) throw new Error("QUOTE_WORD_V2_DISCOUNT_TOTAL_ROW_MISSING");

  const totalRow = range.table.slice(rowRange.start, rowRange.end);
  const discountRow = totalRow.replace(WORD_PARAGRAPH_PATTERN, (paragraph) => {
    const texte = paragraphVisibleText(paragraph);
    if (texte.includes("Total net HT")) {
      return replaceFirstTokenInParagraph(
        paragraph,
        "Total net HT",
        document.totals.customerDiscountLabel ?? "Remise client",
      ).paragraph;
    }
    if (texte.includes("{{total_ht}}")) {
      return replaceFirstTokenInParagraph(
        paragraph,
        "{{total_ht}}",
        `−${formatMoneyCents(discountCents)}`,
      ).paragraph;
    }
    return paragraph;
  });

  const nextTable =
    range.table.slice(0, rowRange.start) + discountRow + range.table.slice(rowRange.start);
  return documentXml.slice(0, range.start) + nextTable + documentXml.slice(range.end);
}

export function renderQuoteWordV2CustomerDiscount(
  template: Uint8Array,
  document: QuoteDocumentData,
): Uint8Array {
  return renderDocumentXml(
    template,
    (xml) => replaceQuoteCustomerDiscountRow(xml, document),
    "QUOTE_WORD_V2_DOCUMENT_XML_MISSING",
  );
}

function renderDocumentXml(
  template: Uint8Array,
  transform: (xml: string) => string,
  missingDocumentError: string,
): Uint8Array {
  const entrees = readZipArchive(template);
  let documentXmlFound = false;

  const renderedEntries = entrees.map((entree) => {
    if (entree.name !== "word/document.xml") return entree;
    documentXmlFound = true;
    const xml = Buffer.from(entree.data).toString("utf8");
    return cloneZipEntryWithData(entree, Buffer.from(transform(xml), "utf8"));
  });

  if (!documentXmlFound) throw new Error(missingDocumentError);
  return writeZipArchive(renderedEntries);
}

export function renderQuoteWordV2Body(
  template: Uint8Array,
  document: QuoteDocumentData,
): Uint8Array {
  return renderDocumentXml(
    template,
    (xml) => replaceQuoteBodyAnchor(xml, document),
    "QUOTE_WORD_V2_DOCUMENT_XML_MISSING",
  );
}

export function renderQuoteWordV2Options(
  template: Uint8Array,
  document: QuoteDocumentData,
): Uint8Array {
  return renderDocumentXml(
    template,
    (xml) => replaceQuoteOptionsAnchor(xml, document),
    "QUOTE_WORD_V2_DOCUMENT_XML_MISSING",
  );
}

export function renderQuoteWordV2Scalars(
  template: Uint8Array,
  scalarData: QuoteWordV2ScalarData,
): Uint8Array {
  const entrees = readZipArchive(template);
  const totalReplacementCounts = new Map<string, number>();
  for (const cle of Object.keys(scalarData)) totalReplacementCounts.set(cle, 0);

  const renderedEntries = entrees.map((entree) => {
    if (!isWordXmlEntry(entree.name)) return entree;

    const xml = Buffer.from(entree.data).toString("utf8");
    const rendered = replaceWordXmlScalarTokens(
      xml,
      scalarData as unknown as Readonly<Record<string, string>>,
    );
    for (const [cle, nombre] of rendered.replacementCounts) {
      totalReplacementCounts.set(cle, (totalReplacementCounts.get(cle) ?? 0) + nombre);
    }
    return cloneZipEntryWithData(entree, Buffer.from(rendered.xml, "utf8"));
  });

  for (const [cle, nombre] of totalReplacementCounts) {
    if (nombre === 0) throw new Error(`QUOTE_WORD_V2_SCALAR_TOKEN_MISSING:${cle}`);
  }

  return writeZipArchive(renderedEntries);
}
