import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readZipArchive } from "../src/lib/documents/zip-archive";
import {
  assertQuoteWordV2TemplateContract,
  inspectQuoteWordV2Template,
  renderQuoteWordV2OptionalBlocks,
} from "../src/lib/quotes/word-v2-template-contract";
import { renderQuoteWordV2Layout } from "../src/lib/quotes/word-v2-renderer";

const templatePath = new URL("../docs/templates/PAPOT_Template_Devis_V2.docx", import.meta.url);

function documentXml(docx: Uint8Array): string {
  const entry = readZipArchive(docx).find((candidate) => candidate.name === "word/document.xml");
  if (!entry) throw new Error("TEST_DOCUMENT_XML_MISSING");
  return Buffer.from(entry.data).toString("utf8");
}

describe("quote Word V2 template contract", () => {
  it("verrouille les ancres, la pagination et les lignes dynamiques du modele", () => {
    const template = readFileSync(templatePath);
    const inspection = inspectQuoteWordV2Template(template);

    expect(() => assertQuoteWordV2TemplateContract(template)).not.toThrow();
    expect(inspection.quoteBodyColumnCount).toBe(6);
    expect(inspection.optionsColumnCount).toBe(6);
    expect(inspection.quoteBodyRowHasFixedHeight).toBe(false);
    expect(inspection.optionsRowHasFixedHeight).toBe(false);
    expect(inspection.quoteHeaderRepeats).toBe(true);
    expect(inspection.hasPageField).toBe(true);
    expect(inspection.hasNumPagesField).toBe(true);
    expect(Object.values(inspection.anchorCounts).every((count) => count === 1)).toBe(true);
  });

  it("verrouille le gabarit PDF contre les déformations observées en recette", () => {
    const template = readFileSync(templatePath);
    const xml = documentXml(renderQuoteWordV2Layout(template));

    expect(xml).not.toContain("OPTIONS NON COMPRISES DANS LE TOTAL PRINCIPAL");

    const bodyTable = xml.match(/<w:tbl[\s\S]*?\{\{PAPOT_QUOTE_BODY\}\}[\s\S]*?<\/w:tbl>/)?.[0];
    const optionsTable = xml.match(
      /<w:tbl[\s\S]*?\{\{PAPOT_OPTIONS_BLOCK\}\}[\s\S]*?<\/w:tbl>/,
    )?.[0];
    expect(bodyTable).toBeTruthy();
    expect(optionsTable).toBeTruthy();

    for (const table of [bodyTable!, optionsTable!]) {
      expect(table).toContain('<w:tblLayout w:type="fixed"');
      expect(table).toContain('<w:gridCol w:w="850"');
      expect(table).toContain('<w:gridCol w:w="4933"');
      expect(table).toContain('<w:gridCol w:w="1134"');
      expect(table).toContain('<w:gridCol w:w="1417"');
      expect(table).toContain('<w:gridCol w:w="1077"');
      expect(table).toContain('<w:gridCol w:w="1587"');
    }

    const financialTable = xml.match(
      /<w:tbl[\s\S]*?\{\{total_ht\}\}[\s\S]*?Pour le client[\s\S]*?<\/w:tbl>/,
    )?.[0];
    expect(financialTable).toBeTruthy();
    expect(financialTable).toContain('<w:gridSpan w:val="2"');
    expect(financialTable).toContain('<w:gridCol w:w="2900"');
    expect(financialTable).toContain('<w:gridCol w:w="1672"');
    expect((financialTable?.match(/<w:tr\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("supprime proprement les blocs optionnels non utilises", () => {
    const template = readFileSync(templatePath);
    const rendered = renderQuoteWordV2OptionalBlocks(template, {
      qrActions: false,
      annexImages: false,
    });
    const xml = documentXml(rendered);

    expect(xml).not.toContain("{{PAPOT_QR_ACTIONS_BLOCK}}");
    expect(xml).not.toContain("{{PAPOT_ANNEX_IMAGES}}");
    expect(xml).toContain("{{PAPOT_QUOTE_BODY}}");
    expect(xml).toContain("{{PAPOT_OPTIONS_BLOCK}}");
    expect(xml).toContain("{{PAPOT_VAT_SUMMARY}}");
    expect(xml).toContain("{{PAPOT_VAT_LINES_ANCHOR}}");
  });
});
