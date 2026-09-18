import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ServerFileStore } from "../src/lib/server-files/storage";
import {
  archiveFinalQuotePdf,
  nextFinalQuoteNumber,
  quoteFinalPdfFileName,
  quoteFinalPdfStoragePath,
} from "../src/lib/quotes/final-pdf-archive";
import type { NativeQuotesPayload } from "../src/lib/quotes/store";

const roots: string[] = [];
const quote = { variantName: "Variante A", version: 2 };
const context = {
  creationYear: 2026,
  clientName: "CLIENT TEST",
  caseName: "AGENCEMENT TEST",
};
const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const changedPdf = Buffer.from(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n%%EOF\n",
);

async function createStore() {
  const root = await mkdtemp(path.join(tmpdir(), "papot-final-pdf-"));
  roots.push(root);
  return new ServerFileStore(root);
}

function numberedPayload(numbers: string[]): NativeQuotesPayload {
  return {
    schemaVersion: 1,
    quotes: numbers.map((quoteNumber, index) => ({
      id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
      commercialCaseId: "22222222-2222-4222-8222-222222222222",
      quoteKind: "STANDARD",
      variantName: "Base",
      version: index + 1,
      status: "SENT",
      sentAt: "2026-09-17T20:00:00.000Z",
      followUpDate: "2026-09-30",
      finalPdf: {
        quoteNumber,
        variantName: "Base",
        version: index + 1,
        commercialDocumentId: `${String(index + 1).padStart(8, "0")}-3333-4333-8333-333333333333`,
        fileName: `Devis ${quoteNumber} - Base - V${index + 1}.pdf`,
        storagePath: `Commercial/2026/TEST/Devis/${quoteNumber}.pdf`,
        sizeBytes: 100,
        sha256: "a".repeat(64),
        archivedAt: "2026-09-17T20:00:00.000Z",
        archivedByName: "TEST",
      },
      internalNotes: "",
      pricingConfig: { adjustments: [], options: [] },
      workSchedule: { startDate: null, duration: "", endDate: null },
      taxConfig: { defaultRatePercent: 20, lineOverrides: [] },
      model: {
        id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
        clientId: "44444444-4444-4444-8444-444444444444",
        subject: "TEST",
        issueDate: "2026-09-17",
        validityDays: 30,
        paymentTerms: "TEST",
        items: [],
      },
      createdAt: "2026-09-17T20:00:00.000Z",
      createdByName: "TEST",
      updatedAt: "2026-09-17T20:00:00.000Z",
      updatedByName: "TEST",
    })),
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("final quote PDF archive", () => {
  it("allocates the next annual final quote number without reusing an existing number", () => {
    expect(nextFinalQuoteNumber(numberedPayload([]), 2026)).toBe("D-2026-0001");
    expect(nextFinalQuoteNumber(numberedPayload(["D-2026-0002", "D-2026-0004"]), 2026)).toBe(
      "D-2026-0005",
    );
    expect(nextFinalQuoteNumber(numberedPayload(["D-2025-0099"]), 2026)).toBe("D-2026-0001");
  });

  it("uses one Devis folder and identifies number, variant and version in the file name", () => {
    expect(quoteFinalPdfFileName(quote, "D-2026-0042")).toBe(
      "Devis D-2026-0042 - Variante A - V2.pdf",
    );
    const storagePath = quoteFinalPdfStoragePath(context, quote, "D-2026-0042");
    expect(storagePath).toContain("/Devis/Devis D-2026-0042 - Variante A - V2.pdf");
    expect(storagePath).not.toContain("/Variante A/");
  });

  it("creates the PDF once and reuses only an identical existing archive", async () => {
    const store = await createStore();
    const first = await archiveFinalQuotePdf(store, {
      quote,
      quoteNumber: "D-2026-0042",
      context,
      pdf,
      actorName: "TEST",
      now: new Date("2026-09-17T20:00:00.000Z"),
    });
    expect(first.created).toBe(true);
    expect(first.finalPdf).toMatchObject({
      quoteNumber: "D-2026-0042",
      variantName: "Variante A",
      version: 2,
      fileName: "Devis D-2026-0042 - Variante A - V2.pdf",
      archivedByName: "TEST",
    });
    expect(first.commercialDocument).toMatchObject({
      id: first.finalPdf.commercialDocumentId,
      category: "QUOTE",
      variantLabel: "Variante A",
      versionLabel: "V2",
      isCurrent: true,
      isSignedQuote: false,
    });

    const second = await archiveFinalQuotePdf(store, {
      quote,
      quoteNumber: "D-2026-0042",
      context,
      pdf,
      actorName: "TEST",
    });
    expect(second.created).toBe(false);
    expect(second.finalPdf.sha256).toBe(first.finalPdf.sha256);
  });

  it("never overwrites a different PDF with the same number, variant and version", async () => {
    const store = await createStore();
    const first = await archiveFinalQuotePdf(store, {
      quote,
      quoteNumber: "D-2026-0042",
      context,
      pdf,
      actorName: "TEST",
    });

    await expect(
      archiveFinalQuotePdf(store, {
        quote,
        quoteNumber: "D-2026-0042",
        context,
        pdf: changedPdf,
        actorName: "TEST",
      }),
    ).rejects.toThrow("QUOTE_FINAL_PDF_ARCHIVE_CONFLICT");

    const stored = await store.readBytes(first.finalPdf.storagePath);
    expect(stored).toEqual(pdf);
  });

  it("rejects invalid PDF bytes before creating the archive", async () => {
    const store = await createStore();
    await expect(
      archiveFinalQuotePdf(store, {
        quote,
        quoteNumber: "D-2026-0042",
        context,
        pdf: Buffer.from("not a pdf"),
        actorName: "TEST",
      }),
    ).rejects.toThrow("PDF_INVALID_HEADER");
  });
});
