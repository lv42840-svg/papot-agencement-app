import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  assertPdfBuffer,
  compareRenderedPdfPages,
  convertDocxToPdf,
  convertDocxToPdfWithLibreOffice,
  renderPdfToPngPages,
  type PdfCommandRunner,
} from "../src/lib/documents/pdf-runtime";

const validPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "ascii");

function optionValue(args: string[], option: string): string {
  const index = args.indexOf(option);
  if (index < 0 || !args[index + 1]) throw new Error(`TEST_OPTION_MISSING:${option}`);
  return args[index + 1];
}

describe("PDF runtime", () => {
  it("convertit un DOCX via LibreOffice et valide le PDF produit", async () => {
    const runner: PdfCommandRunner = async (command, args) => {
      expect(command).toBe("fake-soffice");
      expect(args).toContain("--headless");
      const outputDir = optionValue(args, "--outdir");
      await writeFile(`${outputDir}/quote.pdf`, validPdf);
      return { exitCode: 0, stdout: "converted", stderr: "" };
    };

    const pdf = await convertDocxToPdfWithLibreOffice(Buffer.from("PK-test-docx"), {
      binary: "fake-soffice",
      commandRunner: runner,
    });

    expect(Buffer.from(pdf)).toEqual(validPdf);
    expect(() => assertPdfBuffer(pdf)).not.toThrow();
  });

  it("bascule sur Microsoft Word sous Windows quand LibreOffice est absent", async () => {
    const missingLibreOffice: PdfCommandRunner = async () => {
      const error = new Error("missing LibreOffice") as Error & { code?: string };
      error.code = "ENOENT";
      throw error;
    };
    const wordRunner: PdfCommandRunner = async (command, args) => {
      expect(command).toBe("fake-powershell");
      expect(args).toContain("-ExecutionPolicy");
      const outputPath = args.at(-1);
      if (!outputPath) throw new Error("TEST_OUTPUT_PATH_MISSING");
      await writeFile(outputPath, validPdf);
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const pdf = await convertDocxToPdf(Buffer.from("PK-test-docx"), {
      binary: "missing-soffice",
      platform: "win32",
      commandRunner: missingLibreOffice,
      wordBinary: "fake-powershell",
      wordCommandRunner: wordRunner,
    });

    expect(Buffer.from(pdf)).toEqual(validPdf);
  });

  it("rend les pages PDF en PNG dans leur ordre naturel", async () => {
    const runner: PdfCommandRunner = async (command, args) => {
      expect(command).toBe("fake-pdftoppm");
      const prefix = args.at(-1);
      if (!prefix) throw new Error("TEST_PREFIX_MISSING");
      await writeFile(`${prefix}-2.png`, Buffer.from("page-two"));
      await writeFile(`${prefix}-1.png`, Buffer.from("page-one"));
      return { exitCode: 0, stdout: "", stderr: "" };
    };

    const pages = await renderPdfToPngPages(validPdf, {
      binary: "fake-pdftoppm",
      commandRunner: runner,
    });

    expect(pages.map((page) => Buffer.from(page).toString("utf8"))).toEqual([
      "page-one",
      "page-two",
    ]);
  });

  it("signale précisément les pages visuellement différentes", () => {
    const comparison = compareRenderedPdfPages(
      [Buffer.from("page-a"), Buffer.from("page-b")],
      [Buffer.from("page-a"), Buffer.from("page-c"), Buffer.from("page-d")],
    );

    expect(comparison.matches).toBe(false);
    expect(comparison.referencePageCount).toBe(2);
    expect(comparison.actualPageCount).toBe(3);
    expect(comparison.changedPages).toEqual([2, 3]);
    expect(comparison.referencePageHashes[0]).toBe(comparison.actualPageHashes[0]);
  });

  it("refuse un fichier qui n'est pas un PDF complet", () => {
    expect(() => assertPdfBuffer(Buffer.from("not a pdf"))).toThrow("PDF_INVALID_HEADER");
    expect(() => assertPdfBuffer(Buffer.from("%PDF-1.4\nwithout eof marker"))).toThrow(
      "PDF_EOF_MISSING",
    );
  });
});
