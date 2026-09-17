import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readZipArchive } from "../src/lib/documents/zip-archive";
import { renderQuoteWordV2FilledDocxWithPhotos } from "../src/lib/quotes/word-v2-filled-docx";
import { makeQuoteWordV2TestDocument } from "./fixtures/quote-word-v2-document";

const templatePath = new URL("../docs/templates/PAPOT_Template_Devis_V2.docx", import.meta.url);
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

describe("quote Word V2 photos", () => {
  it("insère les photos visibles dans le DOCX avec relation et média", async () => {
    const template = readFileSync(templatePath);
    const document = makeQuoteWordV2TestDocument();
    const sha256 = createHash("sha256").update(onePixelPng).digest("hex");
    document.items[1].clientPhotos = [
      {
        id: "66666666-6666-4666-8666-666666666666",
        fileName: "chantier.png",
        contentType: "image/png",
        sizeBytes: onePixelPng.byteLength,
        sha256,
        storagePath: "quotes/test/chantier.png",
        clientVisible: true,
        uploadedAt: "2026-09-17T12:00:00.000Z",
        uploadedByName: "TEST",
      },
    ];

    const requestedPaths: string[] = [];
    const docx = await renderQuoteWordV2FilledDocxWithPhotos(template, document, async (photo) => {
      requestedPaths.push(photo.storagePath);
      return onePixelPng;
    });
    const entries = readZipArchive(docx);
    const xml = Buffer.from(
      entries.find((entry) => entry.name === "word/document.xml")?.data ?? [],
    ).toString("utf8");
    const rels = Buffer.from(
      entries.find((entry) => entry.name === "word/_rels/document.xml.rels")?.data ?? [],
    ).toString("utf8");

    expect(requestedPaths).toEqual(["quotes/test/chantier.png"]);
    expect(entries.some((entry) => entry.name === "word/media/papot-quote-photo-1.png")).toBe(true);
    expect(xml).toContain("<w:drawing>");
    expect(xml).toContain("PHOTOS CLIENT");
    expect(xml).toContain("Fabrication banque accueil");
    expect(xml).not.toContain("{{PAPOT_ANNEX_IMAGES}}");
    expect(rels).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"');
    expect(rels).toContain('Target="media/papot-quote-photo-1.png"');
  });

  it("refuse un contenu photo différent du hash attendu", async () => {
    const template = readFileSync(templatePath);
    const document = makeQuoteWordV2TestDocument();
    document.items[1].clientPhotos = [
      {
        id: "77777777-7777-4777-8777-777777777777",
        fileName: "chantier.png",
        contentType: "image/png",
        sizeBytes: onePixelPng.byteLength,
        sha256: "0".repeat(64),
        storagePath: "quotes/test/chantier.png",
        clientVisible: true,
        uploadedAt: "2026-09-17T12:00:00.000Z",
        uploadedByName: "TEST",
      },
    ];

    await expect(
      renderQuoteWordV2FilledDocxWithPhotos(template, document, async () => onePixelPng),
    ).rejects.toThrow("QUOTE_WORD_V2_PHOTO_SHA256_MISMATCH");
  });
});
