import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { comparePdfVisualRenders, renderPdfToPngPages } from "../src/lib/documents/pdf-runtime";
import { readZipArchive } from "../src/lib/documents/zip-archive";
import { renderQuoteWordV2FilledDocx } from "../src/lib/quotes/word-v2-filled-docx";
import {
  renderQuoteWordV2Pdf,
  renderQuoteWordV2PdfWithPhotos,
} from "../src/lib/quotes/word-v2-pdf";
import type { QuoteDocumentItem } from "../src/lib/quotes/document-data";
import { makeQuoteWordV2TestDocument } from "./fixtures/quote-word-v2-document";

const templatePath = new URL("../docs/templates/PAPOT_Template_Devis_V2.docx", import.meta.url);
const pdfIntegration = process.env.PAPOT_RUN_PDF_INTEGRATION === "1" ? describe : describe.skip;
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

function longQuoteDocument() {
  const document = makeQuoteWordV2TestDocument("D-2026-LONG");
  const section = document.items[0];
  const lines: QuoteDocumentItem[] = Array.from({ length: 72 }, (_, index) => ({
    id: `long-line-${index + 1}`,
    kind: "LINE",
    number: `1.${index + 1}`,
    parentId: section.id,
    text: `Ligne longue ${index + 1} - fabrication, fourniture et pose avec description détaillée pour vérifier la pagination automatique du devis.`,
    richText: null,
    clientPhotos: [],
    scope: "MAIN",
    optionId: null,
    optionLabel: null,
    optionStatus: null,
    quantity: 1,
    unit: "u",
    unitPriceHt: 100,
    totalHtCents: 10000,
    vatRatePercent: 20,
    vatCents: 2000,
  }));

  lines.push({
    id: "retained-option-line",
    kind: "LINE",
    number: "1.73",
    parentId: section.id,
    text: "OPTION RETENUE - habillage complémentaire",
    richText: null,
    clientPhotos: [],
    scope: "RETAINED_OPTION",
    optionId: "option-retained",
    optionLabel: "Habillage complémentaire",
    optionStatus: "RETAINED",
    quantity: 1,
    unit: "u",
    unitPriceHt: 150,
    totalHtCents: 15000,
    vatRatePercent: 20,
    vatCents: 3000,
  });
  lines.push({
    id: "rejected-option-line",
    kind: "LINE",
    number: "",
    parentId: section.id,
    text: "OPTION REJETEE - NE DOIT PAS APPARAITRE",
    richText: null,
    clientPhotos: [],
    scope: "REJECTED_OPTION",
    optionId: "option-rejected",
    optionLabel: "Option rejetée",
    optionStatus: "REJECTED",
    quantity: 1,
    unit: "u",
    unitPriceHt: 50,
    totalHtCents: 5000,
    vatRatePercent: 20,
    vatCents: 1000,
  });

  const sha256 = createHash("sha256").update(onePixelPng).digest("hex");
  lines[10].clientPhotos = [
    {
      id: "88888888-8888-4888-8888-888888888888",
      fileName: "photo-longue.png",
      contentType: "image/png",
      sizeBytes: onePixelPng.byteLength,
      sha256,
      storagePath: "quotes/test/photo-longue.png",
      clientVisible: true,
      uploadedAt: "2026-09-17T12:00:00.000Z",
      uploadedByName: "TEST",
    },
  ];

  document.items = [section, ...lines];
  document.pendingOptions = [
    {
      id: "option-pending",
      label: "OPTION NON COMPRISE - éclairage décoratif",
      totalHtCents: 25000,
      totalVatCents: 5000,
      totalTtcCents: 30000,
    },
    {
      id: "option-pending-2",
      label: "OPTION NON COMPRISE - tablette complémentaire",
      totalHtCents: 18000,
      totalVatCents: 3600,
      totalTtcCents: 21600,
    },
  ];
  document.totals = {
    totalHtCents: 735000,
    totalVatCents: 147000,
    totalTtcCents: 882000,
    taxLines: [{ ratePercent: 20, baseHtCents: 735000, vatCents: 147000 }],
  };
  return document;
}

pdfIntegration("quote Word V2 PDF integration", () => {
  it("convertit réellement avec LibreOffice et détecte une différence visuelle", async () => {
    const template = readFileSync(templatePath);
    const referenceDocument = makeQuoteWordV2TestDocument("D-2026-0042");
    const artifactDirValue = process.env.PAPOT_PDF_ARTIFACT_DIR?.trim();
    const artifactDir = artifactDirValue ? path.resolve(artifactDirValue) : null;

    if (artifactDir) {
      await mkdir(artifactDir, { recursive: true });
      await writeFile(path.join(artifactDir, "quote-word-v2-template.docx"), template);
      await writeFile(
        path.join(artifactDir, "quote-word-v2-filled.docx"),
        renderQuoteWordV2FilledDocx(template, referenceDocument),
      );
    }

    const reference = await renderQuoteWordV2Pdf(template, referenceDocument);
    const changed = await renderQuoteWordV2Pdf(
      template,
      makeQuoteWordV2TestDocument("D-2026-0043"),
    );

    const pages = await renderPdfToPngPages(reference.pdf);
    expect(pages.length).toBeGreaterThan(0);
    expect(Buffer.from(pages[0]).subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    const same = await comparePdfVisualRenders(reference.pdf, reference.pdf);
    expect(same.matches).toBe(true);
    expect(same.changedPages).toEqual([]);

    const comparison = await comparePdfVisualRenders(reference.pdf, changed.pdf);
    expect(comparison.matches).toBe(false);
    expect(comparison.changedPages).toContain(1);

    if (artifactDir) {
      await writeFile(path.join(artifactDir, "quote-word-v2.pdf"), reference.pdf);
      await writeFile(path.join(artifactDir, "quote-word-v2-changed.pdf"), changed.pdf);
      await Promise.all(
        pages.map((page, index) =>
          writeFile(path.join(artifactDir, `quote-word-v2-page-${index + 1}.png`), page),
        ),
      );
      await writeFile(
        path.join(artifactDir, "visual-comparison.json"),
        `${JSON.stringify(comparison, null, 2)}\n`,
        "utf8",
      );
    }
  }, 120_000);

  it("pagine un devis long avec options et annexe photo sans perdre le contenu", async () => {
    const template = readFileSync(templatePath);
    const document = longQuoteDocument();
    const generated = await renderQuoteWordV2PdfWithPhotos(
      template,
      document,
      async () => onePixelPng,
    );
    const pages = await renderPdfToPngPages(generated.pdf);
    expect(pages.length).toBeGreaterThanOrEqual(5);

    const documentXml = Buffer.from(
      readZipArchive(generated.docx).find((entry) => entry.name === "word/document.xml")?.data ??
        [],
    ).toString("utf8");
    expect(documentXml).toContain("OPTION RETENUE - habillage complémentaire");
    expect(documentXml).toContain("OPTION NON COMPRISE - éclairage décoratif");
    expect(documentXml).not.toContain("OPTION REJETEE - NE DOIT PAS APPARAITRE");
    expect(documentXml).toContain("<w:drawing>");
    expect(documentXml).not.toContain("{{PAPOT_ANNEX_IMAGES}}");

    const artifactDirValue = process.env.PAPOT_PDF_ARTIFACT_DIR?.trim();
    if (artifactDirValue) {
      const artifactDir = path.resolve(artifactDirValue);
      await mkdir(artifactDir, { recursive: true });
      await writeFile(path.join(artifactDir, "quote-word-v2-long.docx"), generated.docx);
      await writeFile(path.join(artifactDir, "quote-word-v2-long.pdf"), generated.pdf);
      await Promise.all(
        pages.map((page, index) =>
          writeFile(path.join(artifactDir, `quote-word-v2-long-page-${index + 1}.png`), page),
        ),
      );
    }
  }, 120_000);
});
