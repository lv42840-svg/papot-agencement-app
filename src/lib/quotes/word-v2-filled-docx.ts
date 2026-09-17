import {
  cloneZipEntryWithData,
  readZipArchive,
  writeZipArchive,
  type ZipArchiveEntry,
} from "../documents/zip-archive";
import {
  loadQuoteDocumentDataFromSources,
  type QuoteDocumentDataMappingInput,
  type QuoteDocumentDataSources,
} from "./document-data-mapping";
import { buildQuoteWordV2ScalarData, type QuoteDocumentData } from "./document-data";
import {
  renderQuoteWordV2Body,
  renderQuoteWordV2Options,
  renderQuoteWordV2Scalars,
} from "./word-v2-renderer";
import {
  assertQuoteWordV2TemplateContract,
  renderQuoteWordV2OptionalBlocks,
} from "./word-v2-template-contract";
import { renderQuoteWordV2Vat } from "./word-v2-vat-renderer";

export type GeneratedQuoteWordV2Docx = {
  document: QuoteDocumentData;
  docx: Uint8Array;
};

function unresolvedTemplateTokens(docx: Uint8Array): string[] {
  const wordXml = readZipArchive(docx)
    .filter((entry) => entry.name.startsWith("word/") && entry.name.endsWith(".xml"))
    .map((entry) => Buffer.from(entry.data).toString("utf8"))
    .join("\n");

  return Array.from(new Set(wordXml.match(/\{\{[A-Za-z0-9_]+\}\}/g) ?? [])).sort();
}

function assertBalancedWordXml(xml: string, partName: string): void {
  const tagPattern = /<\/?[A-Za-z_][A-Za-z0-9_.:-]*(?:\s[^<>]*?)?\s*\/?>/g;
  const stack: string[] = [];

  for (const match of xml.matchAll(tagPattern)) {
    const tag = match[0];
    if (tag.startsWith("<?") || tag.startsWith("<!") || tag.endsWith("/>")) continue;
    const closing = tag.startsWith("</");
    const name = tag.match(/^<\/?([A-Za-z_][A-Za-z0-9_.:-]*)/)?.[1];
    if (!name) continue;

    if (!closing) {
      stack.push(name);
      continue;
    }

    const open = stack.pop();
    if (open !== name) {
      throw new Error(`QUOTE_WORD_V2_XML_UNBALANCED:${partName}:${open ?? "NONE"}:${name}`);
    }
  }

  if (stack.length > 0) {
    throw new Error(`QUOTE_WORD_V2_XML_UNCLOSED:${partName}:${stack.at(-1)}`);
  }
}

function removeStylesRelationship(xml: string): string {
  return xml.replace(
    /<Relationship\b[^>]*\bType="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/styles"[^>]*\/>/g,
    "",
  );
}

function removeStylesContentType(xml: string): string {
  return xml.replace(/<Override\b[^>]*\bPartName="\/word\/styles\.xml"[^>]*\/>/g, "");
}

function withoutCorruptLegacyStyles(docx: Uint8Array): Uint8Array {
  const entries = readZipArchive(docx);
  const normalized: ZipArchiveEntry[] = [];

  for (const entry of entries) {
    if (entry.name === "word/styles.xml") continue;
    if (entry.name === "word/_rels/document.xml.rels") {
      normalized.push(
        cloneZipEntryWithData(
          entry,
          Buffer.from(removeStylesRelationship(Buffer.from(entry.data).toString("utf8")), "utf8"),
        ),
      );
      continue;
    }
    if (entry.name === "[Content_Types].xml") {
      normalized.push(
        cloneZipEntryWithData(
          entry,
          Buffer.from(removeStylesContentType(Buffer.from(entry.data).toString("utf8")), "utf8"),
        ),
      );
      continue;
    }
    normalized.push(entry);
  }

  return writeZipArchive(normalized);
}

export function assertQuoteWordV2FilledDocx(docx: Uint8Array): void {
  const entries = readZipArchive(docx);
  const document = entries.find((entry) => entry.name === "word/document.xml");
  if (!document) throw new Error("QUOTE_WORD_V2_DOCUMENT_XML_MISSING");

  for (const entry of entries) {
    if (!entry.name.endsWith(".xml") && !entry.name.endsWith(".rels")) continue;
    assertBalancedWordXml(Buffer.from(entry.data).toString("utf8"), entry.name);
  }

  const unresolved = unresolvedTemplateTokens(docx);
  if (unresolved.length > 0) {
    throw new Error(`QUOTE_WORD_V2_UNRESOLVED_TOKENS:${unresolved.join(",")}`);
  }
}

export function renderQuoteWordV2FilledDocx(
  template: Uint8Array,
  document: QuoteDocumentData,
): Uint8Array {
  assertQuoteWordV2TemplateContract(template);

  let rendered = renderQuoteWordV2Scalars(template, buildQuoteWordV2ScalarData(document));
  rendered = renderQuoteWordV2Body(rendered, document);
  rendered = renderQuoteWordV2Options(rendered, document);
  rendered = renderQuoteWordV2Vat(rendered, document);
  rendered = renderQuoteWordV2OptionalBlocks(rendered, {
    qrActions: false,
    annexImages: false,
  });
  rendered = withoutCorruptLegacyStyles(rendered);

  assertQuoteWordV2FilledDocx(rendered);
  return rendered;
}

export async function generateQuoteWordV2FilledDocxFromSources(
  template: Uint8Array,
  input: QuoteDocumentDataMappingInput,
  sources: QuoteDocumentDataSources,
): Promise<GeneratedQuoteWordV2Docx> {
  const document = await loadQuoteDocumentDataFromSources(input, sources);
  return {
    document,
    docx: renderQuoteWordV2FilledDocx(template, document),
  };
}
