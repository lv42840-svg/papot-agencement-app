import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readZipArchive } from "../src/lib/documents/zip-archive";
import type { QuoteDocumentData } from "../src/lib/quotes/document-data";
import { renderQuoteWordV2Options } from "../src/lib/quotes/word-v2-renderer";

const templatePath = new URL("../docs/templates/PAPOT_Template_Devis_V2.docx", import.meta.url);
const pendingOptionId = "11111111-1111-4111-8111-111111111111";
const retainedOptionId = "22222222-2222-4222-8222-222222222222";
const rejectedOptionId = "33333333-3333-4333-8333-333333333333";

function documentXml(docx: Uint8Array): string {
  const entry = readZipArchive(docx).find((candidate) => candidate.name === "word/document.xml");
  expect(entry).toBeDefined();
  return Buffer.from(entry!.data).toString("utf8");
}

function tableCount(xml: string): number {
  return Array.from(xml.matchAll(/<w:tbl(?:\s[^>]*)?>/g)).length;
}

function makeDocument(withPendingOption = true): QuoteDocumentData {
  return {
    items: withPendingOption
      ? [
          {
            id: "44444444-4444-4444-8444-444444444444",
            kind: "LINE",
            number: "2.1",
            parentId: null,
            text: "Habillage\ncomplémentaire",
            richText: {
              runs: [
                {
                  text: "Habillage\ncomplémentaire",
                  style: {
                    bold: true,
                    italic: false,
                    underline: false,
                    textColor: "#2563eb",
                    highlightColor: null,
                    fontSizePx: null,
                  },
                },
              ],
            },
            clientPhotos: [],
            scope: "PENDING_OPTION",
            optionId: pendingOptionId,
            optionLabel: "Option habillage complémentaire",
            optionStatus: "PENDING",
            quantity: 1,
            unit: "u",
            unitPriceHt: 50,
            totalHtCents: 5000,
            vatRatePercent: 10,
            vatCents: 500,
          },
          {
            id: "55555555-5555-4555-8555-555555555555",
            kind: "LINE",
            number: "3.1",
            parentId: null,
            text: "OPTION RETENUE NE DOIT PAS ETRE REPETEE",
            richText: null,
            clientPhotos: [],
            scope: "RETAINED_OPTION",
            optionId: retainedOptionId,
            optionLabel: "Option retenue",
            optionStatus: "RETAINED",
            quantity: 1,
            unit: "u",
            unitPriceHt: 75,
            totalHtCents: 7500,
            vatRatePercent: 20,
            vatCents: 1500,
          },
          {
            id: "66666666-6666-4666-8666-666666666666",
            kind: "LINE",
            number: "4.1",
            parentId: null,
            text: "OPTION REJETEE NE DOIT PAS APPARAITRE",
            richText: null,
            clientPhotos: [],
            scope: "REJECTED_OPTION",
            optionId: rejectedOptionId,
            optionLabel: "Option rejetée",
            optionStatus: "REJECTED",
            quantity: 1,
            unit: "u",
            unitPriceHt: 90,
            totalHtCents: 9000,
            vatRatePercent: 20,
            vatCents: 1800,
          },
        ]
      : [],
    pendingOptions: withPendingOption
      ? [
          {
            id: pendingOptionId,
            label: "Option habillage complémentaire",
            totalHtCents: 5000,
            totalVatCents: 500,
            totalTtcCents: 5500,
          },
        ]
      : [],
  } as unknown as QuoteDocumentData;
}

describe("quote Word V2 options", () => {
  it("rend uniquement les options en attente dans leur tableau séparé", () => {
    const template = readFileSync(templatePath);
    const originalXml = documentXml(template);
    const rendered = renderQuoteWordV2Options(template, makeDocument());
    const xml = documentXml(rendered);

    expect(xml).not.toContain("PAPOT_OPTIONS_BLOCK");
    expect(xml).toContain("OPTIONS NON COMPRISES DANS LE TOTAL DU DEVIS");
    expect(xml).toContain("Option habillage complémentaire");
    expect(xml).toContain("Habillage");
    expect(xml).toContain("complémentaire");
    expect(xml).toContain("10 %");
    expect(xml).toContain("50,00");
    expect(xml).not.toContain("Total option HT");
    expect(xml).not.toContain("TVA option");
    expect(xml).not.toContain("Total option TTC");
    expect(xml).toContain('<w:bottom w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>');
    expect(xml).toContain("<w:br/>");
    expect(xml).toContain("<w:b/>");
    expect(xml).toContain('<w:color w:val="2563EB"/>');
    expect(xml).not.toContain("OPTION RETENUE NE DOIT PAS ETRE REPETEE");
    expect(xml).not.toContain("OPTION REJETEE NE DOIT PAS APPARAITRE");
    expect(xml).toContain("{{total_ht}}");
    expect(xml).toContain("{{PAPOT_VAT_SUMMARY}}");
    expect(tableCount(xml)).toBe(tableCount(originalXml));
  });

  it("supprime tout le tableau options lorsqu'il n'y a aucune option en attente", () => {
    const template = readFileSync(templatePath);
    const originalXml = documentXml(template);
    const rendered = renderQuoteWordV2Options(template, makeDocument(false));
    const xml = documentXml(rendered);

    expect(xml).not.toContain("PAPOT_OPTIONS_BLOCK");
    expect(xml).not.toContain("OPTIONS NON COMPRISES DANS LE TOTAL DU DEVIS");
    expect(tableCount(xml)).toBe(tableCount(originalXml) - 1);
    expect(xml).toContain("Total net HT");
    expect(xml).toContain("{{total_ht}}");
    expect(xml).toContain("{{PAPOT_VAT_SUMMARY}}");
  });
});
