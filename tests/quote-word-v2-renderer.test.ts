import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readZipArchive } from "../src/lib/documents/zip-archive";
import type { QuoteWordV2ScalarData } from "../src/lib/quotes/document-data";
import {
  renderQuoteWordV2Scalars,
  replaceWordXmlScalarTokens,
} from "../src/lib/quotes/word-v2-renderer";

const templatePath = new URL("../docs/templates/PAPOT_Template_Devis_V2.docx", import.meta.url);
const manifestPath = new URL(
  "../docs/templates/PAPOT_Template_Devis_V2.manifest.json",
  import.meta.url,
);

type TemplateManifest = {
  scalarTokens: string[];
  dynamicAnchors: Record<string, string>;
};

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as TemplateManifest;

function makeScalarData(): QuoteWordV2ScalarData {
  const values = Object.fromEntries(
    manifest.scalarTokens.map((token) => [token, `TEST_${token.toUpperCase()}`]),
  ) as unknown as QuoteWordV2ScalarData;
  values.societe_nom = "PAPOT & FILS";
  return values;
}

function allWordXml(docx: Uint8Array): string {
  return readZipArchive(docx)
    .filter((entry) => entry.name.startsWith("word/") && entry.name.endsWith(".xml"))
    .map((entry) => Buffer.from(entry.data).toString("utf8"))
    .join("\n");
}

describe("quote Word V2 scalar renderer", () => {
  it("ouvre le vrai template, remplace tous les champs simples et produit un DOCX relisible", () => {
    const template = readFileSync(templatePath);
    const rendered = renderQuoteWordV2Scalars(template, makeScalarData());

    expect(Buffer.from(rendered).subarray(0, 2).toString("ascii")).toBe("PK");
    const xml = allWordXml(rendered);

    for (const token of manifest.scalarTokens) {
      expect(xml).not.toContain(`{{${token}}}`);
    }
    expect(xml).toContain("PAPOT &amp; FILS");
    expect(xml).toContain("TEST_DEVIS_NUMERO");
  });

  it("conserve les ancres dynamiques pour les prochaines briques", () => {
    const rendered = renderQuoteWordV2Scalars(readFileSync(templatePath), makeScalarData());
    const xml = allWordXml(rendered);

    for (const anchor of Object.keys(manifest.dynamicAnchors)) {
      expect(xml).toContain(anchor);
    }
  });

  it("remplace un token même si Word l'a découpé entre plusieurs runs", () => {
    const xml =
      '<w:p><w:r><w:t>{{devis_</w:t></w:r><w:r><w:t>numero}}</w:t></w:r></w:p>';
    const result = replaceWordXmlScalarTokens(xml, { devis_numero: "D&<2026>" });

    expect(result.xml).toContain("D&amp;&lt;2026&gt;");
    expect(result.xml).not.toContain("{{devis_numero}}");
    expect(result.replacementCounts.get("devis_numero")).toBe(1);
  });
});
