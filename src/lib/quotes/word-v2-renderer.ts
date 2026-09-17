import { cloneZipEntryWithData, readZipArchive, writeZipArchive } from "../documents/zip-archive";
import type { QuoteWordV2ScalarData } from "./document-data";

const WORD_PARAGRAPH_PATTERN = /<w:p\b[\s\S]*?<\/w:p>/g;
const WORD_TEXT_PATTERN = /<w:t\b[^>]*>[\s\S]*?<\/w:t>/g;

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
