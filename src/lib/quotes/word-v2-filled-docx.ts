import { readZipArchive } from "../documents/zip-archive";
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

export function assertQuoteWordV2FilledDocx(docx: Uint8Array): void {
  const entries = readZipArchive(docx);
  if (!entries.some((entry) => entry.name === "word/document.xml")) {
    throw new Error("QUOTE_WORD_V2_DOCUMENT_XML_MISSING");
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
