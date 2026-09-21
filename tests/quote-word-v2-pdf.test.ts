import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertQuoteWordV2PdfReady, renderQuoteWordV2Pdf } from "../src/lib/quotes/word-v2-pdf";
import { makeQuoteWordV2TestDocument } from "./fixtures/quote-word-v2-document";

const templatePath = new URL("../docs/templates/PAPOT_Template_Devis_V2.docx", import.meta.url);
const validPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "ascii");

describe("quote Word V2 PDF", () => {
  it("refuse la conversion PDF tant qu'un champ requis par le contrat est vide", () => {
    const document = makeQuoteWordV2TestDocument();
    document.quote.workStartDate = "";
    document.quote.workDuration = "";

    expect(() => assertQuoteWordV2PdfReady(document)).toThrow(
      "QUOTE_WORD_V2_PDF_REQUIRED_FIELDS:travaux_debut,travaux_duree",
    );
  });

  it("produit le DOCX rempli avant de le transmettre au convertisseur PDF", async () => {
    const document = makeQuoteWordV2TestDocument();
    let convertedDocx: Uint8Array | null = null;

    const generated = await renderQuoteWordV2Pdf(
      readFileSync(templatePath),
      document,
      async (docx) => {
        convertedDocx = docx;
        return validPdf;
      },
    );

    expect(convertedDocx).not.toBeNull();
    expect(
      Buffer.from(convertedDocx ?? [])
        .subarray(0, 2)
        .toString("ascii"),
    ).toBe("PK");
    expect(Buffer.from(generated.pdf)).toEqual(validPdf);
    expect(generated.document.quote.number).toBe("D-2026-0042");
  });
});
