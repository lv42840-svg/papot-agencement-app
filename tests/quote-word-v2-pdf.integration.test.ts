import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { comparePdfVisualRenders, renderPdfToPngPages } from "../src/lib/documents/pdf-runtime";
import { renderQuoteWordV2FilledDocx } from "../src/lib/quotes/word-v2-filled-docx";
import { renderQuoteWordV2Pdf } from "../src/lib/quotes/word-v2-pdf";
import { makeQuoteWordV2TestDocument } from "./fixtures/quote-word-v2-document";

const templatePath = new URL("../docs/templates/PAPOT_Template_Devis_V2.docx", import.meta.url);
const pdfIntegration = process.env.PAPOT_RUN_PDF_INTEGRATION === "1" ? describe : describe.skip;

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
});
