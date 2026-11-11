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
import { renderQuoteWordV2Photos, type QuoteWordV2PhotoLoader } from "./word-v2-photo-renderer";
import {
  renderQuoteWordV2Body,
  renderQuoteWordV2CustomerDiscount,
  renderQuoteWordV2Layout,
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
    .filter((entree) => entree.name.startsWith("word/") && entree.name.endsWith(".xml"))
    .map((entree) => Buffer.from(entree.data).toString("utf8"))
    .join("\n");

  return Array.from(new Set(wordXml.match(/\{\{[A-Za-z0-9_]+\}\}/g) ?? [])).sort();
}

function assertBalancedWordXml(xml: string, partName: string): void {
  const tagPattern = /<\/?[A-Za-z_][A-Za-z0-9_.:-]*(?:\s[^<>]*?)?\s*\/?>/g;
  const stack: string[] = [];

  for (const correspondance of xml.matchAll(tagPattern)) {
    const etiquette = correspondance[0];
    if (etiquette.startsWith("<?") || etiquette.startsWith("<!") || etiquette.endsWith("/>"))
      continue;
    const closing = etiquette.startsWith("</");
    const nom = etiquette.match(/^<\/?([A-Za-z_][A-Za-z0-9_.:-]*)/)?.[1];
    if (!nom) continue;

    if (!closing) {
      stack.push(nom);
      continue;
    }

    const open = stack.pop();
    if (open !== nom) {
      throw new Error(`QUOTE_WORD_V2_XML_UNBALANCED:${partName}:${open ?? "NONE"}:${nom}`);
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
  const entrees = readZipArchive(docx);
  const normalized: ZipArchiveEntry[] = [];

  for (const entree of entrees) {
    if (entree.name === "word/styles.xml") continue;
    if (entree.name === "word/_rels/document.xml.rels") {
      normalized.push(
        cloneZipEntryWithData(
          entree,
          Buffer.from(removeStylesRelationship(Buffer.from(entree.data).toString("utf8")), "utf8"),
        ),
      );
      continue;
    }
    if (entree.name === "[Content_Types].xml") {
      normalized.push(
        cloneZipEntryWithData(
          entree,
          Buffer.from(removeStylesContentType(Buffer.from(entree.data).toString("utf8")), "utf8"),
        ),
      );
      continue;
    }
    normalized.push(entree);
  }

  return writeZipArchive(normalized);
}

export function assertQuoteWordV2FilledDocx(docx: Uint8Array): void {
  const entrees = readZipArchive(docx);
  const document = entrees.find((entree) => entree.name === "word/document.xml");
  if (!document) throw new Error("QUOTE_WORD_V2_DOCUMENT_XML_MISSING");

  for (const entree of entrees) {
    if (!entree.name.endsWith(".xml") && !entree.name.endsWith(".rels")) continue;
    assertBalancedWordXml(Buffer.from(entree.data).toString("utf8"), entree.name);
  }

  const unresolved = unresolvedTemplateTokens(docx);
  if (unresolved.length > 0) {
    throw new Error(`QUOTE_WORD_V2_UNRESOLVED_TOKENS:${unresolved.join(",")}`);
  }
}

function renderQuoteWordV2Core(
  template: Uint8Array,
  document: QuoteDocumentData,
  annexImages: boolean,
): Uint8Array {
  assertQuoteWordV2TemplateContract(template);

  let rendered = renderQuoteWordV2Layout(template);
  rendered = renderQuoteWordV2CustomerDiscount(rendered, document);
  rendered = renderQuoteWordV2Scalars(rendered, buildQuoteWordV2ScalarData(document));
  rendered = renderQuoteWordV2Body(rendered, document);
  rendered = renderQuoteWordV2Options(rendered, document);
  rendered = renderQuoteWordV2Vat(rendered, document);
  return renderQuoteWordV2OptionalBlocks(rendered, {
    qrActions: false,
    annexImages,
  });
}

export function renderQuoteWordV2FilledDocx(
  template: Uint8Array,
  document: QuoteDocumentData,
): Uint8Array {
  let rendered = renderQuoteWordV2Core(template, document, false);
  rendered = withoutCorruptLegacyStyles(rendered);

  assertQuoteWordV2FilledDocx(rendered);
  return rendered;
}

export async function renderQuoteWordV2FilledDocxWithPhotos(
  template: Uint8Array,
  document: QuoteDocumentData,
  photoLoader: QuoteWordV2PhotoLoader,
): Promise<Uint8Array> {
  const photoCount = document.items.reduce(
    (somme, element) => somme + element.clientPhotos.length,
    0,
  );
  if (photoCount === 0) return renderQuoteWordV2FilledDocx(template, document);

  let rendered = renderQuoteWordV2Core(template, document, true);
  rendered = await renderQuoteWordV2Photos(rendered, document, photoLoader);
  rendered = withoutCorruptLegacyStyles(rendered);

  assertQuoteWordV2FilledDocx(rendered);
  return rendered;
}

export async function generateQuoteWordV2FilledDocxFromSources(
  template: Uint8Array,
  saisie: QuoteDocumentDataMappingInput,
  sources: QuoteDocumentDataSources,
): Promise<GeneratedQuoteWordV2Docx> {
  const document = await loadQuoteDocumentDataFromSources(saisie, sources);
  return {
    document,
    docx: renderQuoteWordV2FilledDocx(template, document),
  };
}
