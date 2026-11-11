import {
  cloneZipEntryWithData,
  readZipArchive,
  writeZipArchive,
  type ZipArchiveEntry,
} from "../documents/zip-archive";

export const QUOTE_WORD_V2_DYNAMIC_ANCHORS = [
  "PAPOT_QUOTE_BODY",
  "PAPOT_OPTIONS_BLOCK",
  "PAPOT_VAT_SUMMARY",
  "PAPOT_VAT_LINES_ANCHOR",
  "PAPOT_QR_ACTIONS_BLOCK",
  "PAPOT_ANNEX_IMAGES",
] as const;

const BODY_ANCHOR = "{{PAPOT_QUOTE_BODY}}";
const OPTIONS_ANCHOR = "{{PAPOT_OPTIONS_BLOCK}}";
const QR_ACTIONS_ANCHOR = "{{PAPOT_QR_ACTIONS_BLOCK}}";
const ANNEX_IMAGES_ANCHOR = "{{PAPOT_ANNEX_IMAGES}}";

export type QuoteWordV2TemplateInspection = {
  anchorCounts: Readonly<Record<(typeof QUOTE_WORD_V2_DYNAMIC_ANCHORS)[number], number>>;
  hasPageField: boolean;
  hasNumPagesField: boolean;
  quoteHeaderRepeats: boolean;
  quoteBodyColumnCount: number;
  quoteBodyRowHasFixedHeight: boolean;
  optionsColumnCount: number;
  optionsRowHasFixedHeight: boolean;
};

export type QuoteWordV2OptionalBlockUsage = {
  qrActions: boolean;
  annexImages: boolean;
};

type XmlRange = { start: number; end: number };

function wordXmlEntries(entrees: readonly ZipArchiveEntry[]): ZipArchiveEntry[] {
  return entrees.filter(
    (entree) => entree.name.startsWith("word/") && entree.name.endsWith(".xml"),
  );
}

function documentXml(entrees: readonly ZipArchiveEntry[]): string {
  const entree = entrees.find((candidat) => candidat.name === "word/document.xml");
  if (!entree) throw new Error("QUOTE_WORD_V2_DOCUMENT_XML_MISSING");
  return Buffer.from(entree.data).toString("utf8");
}

function countOccurrences(valeur: string, needle: string): number {
  if (!needle) return 0;
  let nombre = 0;
  let offset = 0;
  while (offset < valeur.length) {
    const indice = valeur.indexOf(needle, offset);
    if (indice < 0) break;
    nombre += 1;
    offset = indice + needle.length;
  }
  return nombre;
}

function escapeRegExp(valeur: string): string {
  return valeur.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containingRange(xml: string, anchorIndex: number, tagName: string): XmlRange | null {
  const pattern = new RegExp(`<(/?)${escapeRegExp(tagName)}\\b[^>]*?(\\/?)>`, "g");
  const openStarts: number[] = [];

  for (const correspondance of xml.slice(0, anchorIndex + 1).matchAll(pattern)) {
    const closing = correspondance[1] === "/";
    const selfClosing = correspondance[2] === "/";
    if (closing) {
      openStarts.pop();
    } else if (!selfClosing && correspondance.index !== undefined) {
      openStarts.push(correspondance.index);
    }
  }

  const debut = openStarts.at(-1);
  if (debut === undefined) return null;

  const matchingPattern = new RegExp(`<(/?)${escapeRegExp(tagName)}\\b[^>]*?(\\/?)>`, "g");
  matchingPattern.lastIndex = debut;
  let depth = 0;
  let correspondance: RegExpExecArray | null;

  while ((correspondance = matchingPattern.exec(xml)) !== null) {
    const closing = correspondance[1] === "/";
    const selfClosing = correspondance[2] === "/";
    if (!closing && !selfClosing) {
      depth += 1;
      continue;
    }
    if (!closing) continue;
    depth -= 1;
    if (depth === 0) return { start: debut, end: matchingPattern.lastIndex };
  }

  return null;
}

function tableColumnCount(rowXml: string): number {
  return Array.from(rowXml.matchAll(/<w:tc(?:\s[^>]*)?>/g)).length;
}

function fieldInstructions(xml: string): string[] {
  const instructions: string[] = [];
  for (const correspondance of xml.matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g)) {
    instructions.push(correspondance[1] ?? "");
  }
  for (const correspondance of xml.matchAll(/<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*>/g)) {
    instructions.push(correspondance[1] ?? "");
  }
  return instructions;
}

function hasExactWordField(instructions: readonly string[], fieldName: string): boolean {
  return instructions.some((instruction) =>
    instruction
      .toUpperCase()
      .split(/[^A-Z]+/)
      .filter(Boolean)
      .includes(fieldName),
  );
}

function anchorCountAcrossWordXml(entrees: readonly ZipArchiveEntry[], anchorName: string): number {
  const token = `{{${anchorName}}}`;
  return wordXmlEntries(entrees).reduce(
    (somme, entree) => somme + countOccurrences(Buffer.from(entree.data).toString("utf8"), token),
    0,
  );
}

function anchorRow(document: string, token: string): string {
  const anchorIndex = document.indexOf(token);
  if (anchorIndex < 0) throw new Error(`QUOTE_WORD_V2_ANCHOR_MISSING:${token}`);
  const range = containingRange(document, anchorIndex, "w:tr");
  if (!range) throw new Error(`QUOTE_WORD_V2_ANCHOR_ROW_MISSING:${token}`);
  return document.slice(range.start, range.end);
}

export function inspectQuoteWordV2Template(template: Uint8Array): QuoteWordV2TemplateInspection {
  const entrees = readZipArchive(template);
  const document = documentXml(entrees);
  const allWordXml = wordXmlEntries(entrees)
    .map((entree) => Buffer.from(entree.data).toString("utf8"))
    .join("\n");
  const instructions = fieldInstructions(allWordXml);

  const bodyIndex = document.indexOf(BODY_ANCHOR);
  if (bodyIndex < 0) throw new Error("QUOTE_WORD_V2_BODY_ANCHOR_MISSING");
  const bodyTableRange = containingRange(document, bodyIndex, "w:tbl");
  if (!bodyTableRange) throw new Error("QUOTE_WORD_V2_BODY_TABLE_MISSING");
  const bodyTableBeforeAnchor = document.slice(bodyTableRange.start, bodyIndex);
  const bodyRow = anchorRow(document, BODY_ANCHOR);
  const optionsRow = anchorRow(document, OPTIONS_ANCHOR);

  const anchorCounts = Object.fromEntries(
    QUOTE_WORD_V2_DYNAMIC_ANCHORS.map((anchor) => [
      anchor,
      anchorCountAcrossWordXml(entrees, anchor),
    ]),
  ) as Record<(typeof QUOTE_WORD_V2_DYNAMIC_ANCHORS)[number], number>;

  return {
    anchorCounts,
    hasPageField: hasExactWordField(instructions, "PAGE"),
    hasNumPagesField: hasExactWordField(instructions, "NUMPAGES"),
    quoteHeaderRepeats: /<w:tblHeader(?:\s[^>]*)?\/?\s*>/.test(bodyTableBeforeAnchor),
    quoteBodyColumnCount: tableColumnCount(bodyRow),
    quoteBodyRowHasFixedHeight: /<w:trHeight\b/.test(bodyRow),
    optionsColumnCount: tableColumnCount(optionsRow),
    optionsRowHasFixedHeight: /<w:trHeight\b/.test(optionsRow),
  };
}

export function assertQuoteWordV2TemplateContract(template: Uint8Array): void {
  const inspection = inspectQuoteWordV2Template(template);

  for (const anchor of QUOTE_WORD_V2_DYNAMIC_ANCHORS) {
    const nombre = inspection.anchorCounts[anchor];
    if (nombre !== 1) throw new Error(`QUOTE_WORD_V2_ANCHOR_COUNT_INVALID:${anchor}:${nombre}`);
  }
  if (!inspection.hasPageField) throw new Error("QUOTE_WORD_V2_PAGE_FIELD_MISSING");
  if (!inspection.hasNumPagesField) throw new Error("QUOTE_WORD_V2_NUMPAGES_FIELD_MISSING");
  if (!inspection.quoteHeaderRepeats) throw new Error("QUOTE_WORD_V2_HEADER_REPEAT_MISSING");
  if (inspection.quoteBodyColumnCount !== 6) {
    throw new Error(`QUOTE_WORD_V2_BODY_COLUMN_COUNT_INVALID:${inspection.quoteBodyColumnCount}`);
  }
  if (inspection.optionsColumnCount !== 6) {
    throw new Error(`QUOTE_WORD_V2_OPTIONS_COLUMN_COUNT_INVALID:${inspection.optionsColumnCount}`);
  }
  if (inspection.quoteBodyRowHasFixedHeight) {
    throw new Error("QUOTE_WORD_V2_BODY_FIXED_HEIGHT_FORBIDDEN");
  }
  if (inspection.optionsRowHasFixedHeight) {
    throw new Error("QUOTE_WORD_V2_OPTIONS_FIXED_HEIGHT_FORBIDDEN");
  }
}

function visibleTextOutsideToken(xml: string, token: string): string {
  return xml
    .replace(token, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos);/g, "")
    .trim();
}

function removeUniqueAnchoredContainer(xml: string, token: string): string {
  const first = xml.indexOf(token);
  if (first < 0) throw new Error(`QUOTE_WORD_V2_OPTIONAL_ANCHOR_MISSING:${token}`);
  if (xml.indexOf(token, first + token.length) >= 0) {
    throw new Error(`QUOTE_WORD_V2_OPTIONAL_ANCHOR_DUPLICATE:${token}`);
  }

  const paragraphRange = containingRange(xml, first, "w:p");
  const rowRange = containingRange(xml, first, "w:tr");
  let range = paragraphRange;

  if (rowRange) {
    const rowXml = xml.slice(rowRange.start, rowRange.end);
    if (visibleTextOutsideToken(rowXml, token).length === 0) range = rowRange;
  }

  if (!range) throw new Error(`QUOTE_WORD_V2_OPTIONAL_CONTAINER_MISSING:${token}`);
  return `${xml.slice(0, range.start)}${xml.slice(range.end)}`;
}

export function replaceQuoteWordV2OptionalBlocks(
  document: string,
  usage: QuoteWordV2OptionalBlockUsage,
): string {
  let suivant = document;
  if (!usage.qrActions) suivant = removeUniqueAnchoredContainer(suivant, QR_ACTIONS_ANCHOR);
  if (!usage.annexImages) suivant = removeUniqueAnchoredContainer(suivant, ANNEX_IMAGES_ANCHOR);
  return suivant;
}

export function renderQuoteWordV2OptionalBlocks(
  template: Uint8Array,
  usage: QuoteWordV2OptionalBlockUsage,
): Uint8Array {
  const entrees = readZipArchive(template);
  let trouve = false;
  const rendered = entrees.map((entree) => {
    if (entree.name !== "word/document.xml") return entree;
    trouve = true;
    const xml = Buffer.from(entree.data).toString("utf8");
    return cloneZipEntryWithData(
      entree,
      Buffer.from(replaceQuoteWordV2OptionalBlocks(xml, usage), "utf8"),
    );
  });
  if (!trouve) throw new Error("QUOTE_WORD_V2_DOCUMENT_XML_MISSING");
  return writeZipArchive(rendered);
}
