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

function wordXmlEntries(entries: readonly ZipArchiveEntry[]): ZipArchiveEntry[] {
  return entries.filter((entry) => entry.name.startsWith("word/") && entry.name.endsWith(".xml"));
}

function documentXml(entries: readonly ZipArchiveEntry[]): string {
  const entry = entries.find((candidate) => candidate.name === "word/document.xml");
  if (!entry) throw new Error("QUOTE_WORD_V2_DOCUMENT_XML_MISSING");
  return Buffer.from(entry.data).toString("utf8");
}

function countOccurrences(value: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (offset < value.length) {
    const index = value.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + needle.length;
  }
  return count;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containingRange(xml: string, anchorIndex: number, tagName: string): XmlRange | null {
  const pattern = new RegExp(`<(/?)${escapeRegExp(tagName)}\\b[^>]*?(\\/?)>`, "g");
  const openStarts: number[] = [];

  for (const match of xml.slice(0, anchorIndex + 1).matchAll(pattern)) {
    const closing = match[1] === "/";
    const selfClosing = match[2] === "/";
    if (closing) {
      openStarts.pop();
    } else if (!selfClosing && match.index !== undefined) {
      openStarts.push(match.index);
    }
  }

  const start = openStarts.at(-1);
  if (start === undefined) return null;

  const matchingPattern = new RegExp(`<(/?)${escapeRegExp(tagName)}\\b[^>]*?(\\/?)>`, "g");
  matchingPattern.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;

  while ((match = matchingPattern.exec(xml)) !== null) {
    const closing = match[1] === "/";
    const selfClosing = match[2] === "/";
    if (!closing && !selfClosing) {
      depth += 1;
      continue;
    }
    if (!closing) continue;
    depth -= 1;
    if (depth === 0) return { start, end: matchingPattern.lastIndex };
  }

  return null;
}

function tableColumnCount(rowXml: string): number {
  return Array.from(rowXml.matchAll(/<w:tc(?:\s[^>]*)?>/g)).length;
}

function fieldInstructions(xml: string): string[] {
  const instructions: string[] = [];
  for (const match of xml.matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g)) {
    instructions.push(match[1] ?? "");
  }
  for (const match of xml.matchAll(/<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*>/g)) {
    instructions.push(match[1] ?? "");
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

function anchorCountAcrossWordXml(entries: readonly ZipArchiveEntry[], anchorName: string): number {
  const token = `{{${anchorName}}}`;
  return wordXmlEntries(entries).reduce(
    (sum, entry) => sum + countOccurrences(Buffer.from(entry.data).toString("utf8"), token),
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
  const entries = readZipArchive(template);
  const document = documentXml(entries);
  const allWordXml = wordXmlEntries(entries)
    .map((entry) => Buffer.from(entry.data).toString("utf8"))
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
      anchorCountAcrossWordXml(entries, anchor),
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
    const count = inspection.anchorCounts[anchor];
    if (count !== 1) throw new Error(`QUOTE_WORD_V2_ANCHOR_COUNT_INVALID:${anchor}:${count}`);
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
  let next = document;
  if (!usage.qrActions) next = removeUniqueAnchoredContainer(next, QR_ACTIONS_ANCHOR);
  if (!usage.annexImages) next = removeUniqueAnchoredContainer(next, ANNEX_IMAGES_ANCHOR);
  return next;
}

export function renderQuoteWordV2OptionalBlocks(
  template: Uint8Array,
  usage: QuoteWordV2OptionalBlockUsage,
): Uint8Array {
  const entries = readZipArchive(template);
  let found = false;
  const rendered = entries.map((entry) => {
    if (entry.name !== "word/document.xml") return entry;
    found = true;
    const xml = Buffer.from(entry.data).toString("utf8");
    return cloneZipEntryWithData(
      entry,
      Buffer.from(replaceQuoteWordV2OptionalBlocks(xml, usage), "utf8"),
    );
  });
  if (!found) throw new Error("QUOTE_WORD_V2_DOCUMENT_XML_MISSING");
  return writeZipArchive(rendered);
}
