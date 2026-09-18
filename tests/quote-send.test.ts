import { describe, expect, it } from "vitest";
import { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";
import {
  markFrozenNativeQuoteSent,
  markNativeQuoteSent,
  markNativeQuoteSentWithFinalPdf,
  markNativeQuoteValidatedWithFinalPdf,
} from "../src/lib/quotes/send";
import { createInitialNativeQuotesPayload, type QuoteFinalPdf } from "../src/lib/quotes/store";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};
const affairId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";

function draft() {
  return applyQuotesMutation(
    createInitialNativeQuotesPayload(),
    quotesMutationSchema.parse({
      action: "createDraft",
      commercialCaseId: affairId,
      subject: "Agencement accueil",
      issueDate: "2026-09-14",
      variantName: "Base",
      paymentTerms: "30 jours",
    }),
    actor,
    clientId,
    new Date("2026-09-14T15:00:00.000Z"),
  ).payload;
}

function finalPdf(overrides: Partial<QuoteFinalPdf> = {}): QuoteFinalPdf {
  return {
    quoteNumber: "D-2026-0001",
    variantName: "Base",
    version: 1,
    commercialDocumentId: "44444444-4444-4444-8444-444444444444",
    fileName: "Devis D-2026-0001 - Base - V1.pdf",
    storagePath: "Commercial/2026/TEST/Devis/Devis D-2026-0001 - Base - V1.pdf",
    sizeBytes: 1234,
    sha256: "a".repeat(64),
    archivedAt: "2026-09-14T16:00:00.000Z",
    archivedByName: "Lucien",
    ...overrides,
  };
}

describe("native quote send", () => {
  it("marks a draft sent and stores its own mandatory follow-up date", () => {
    const source = draft();
    const quoteId = source.quotes[0].id;
    const result = markNativeQuoteSent(
      source,
      quoteId,
      "2026-09-25",
      actor,
      new Date("2026-09-14T16:00:00.000Z"),
    );

    expect(result.commercialCaseId).toBe(affairId);
    expect(result.payload.quotes[0]).toMatchObject({
      id: quoteId,
      status: "SENT",
      sentAt: "2026-09-14T16:00:00.000Z",
      followUpDate: "2026-09-25",
      finalPdf: null,
      updatedByName: "Lucien",
    });
  });

  it("freezes final PDF metadata with number, variant and version when sent", () => {
    const source = draft();
    const quoteId = source.quotes[0].id;
    const frozen = finalPdf();
    const result = markNativeQuoteSentWithFinalPdf(
      source,
      quoteId,
      "2026-09-25",
      frozen,
      actor,
      new Date("2026-09-14T16:00:00.000Z"),
    );

    expect(result.payload.quotes[0]).toMatchObject({
      status: "SENT",
      finalPdf: frozen,
    });
  });

  it("valide un PDF sans déclarer le devis envoyé, puis l'envoie sans régénérer le PDF", () => {
    const source = draft();
    const quoteId = source.quotes[0].id;
    const frozen = finalPdf();

    const validated = markNativeQuoteValidatedWithFinalPdf(
      source,
      quoteId,
      frozen,
      actor,
      new Date("2026-09-14T16:00:00.000Z"),
    );

    expect(validated.payload.quotes[0]).toMatchObject({
      status: "FROZEN",
      sentAt: null,
      followUpDate: null,
      finalPdf: frozen,
    });

    const sent = markFrozenNativeQuoteSent(
      validated.payload,
      quoteId,
      "2026-09-25",
      actor,
      new Date("2026-09-14T17:00:00.000Z"),
    );

    expect(sent.payload.quotes[0]).toMatchObject({
      status: "SENT",
      sentAt: "2026-09-14T17:00:00.000Z",
      followUpDate: "2026-09-25",
      finalPdf: frozen,
    });
  });

  it("rejects final PDF metadata from another variant or version", () => {
    const source = draft();
    const quoteId = source.quotes[0].id;

    expect(() =>
      markNativeQuoteSentWithFinalPdf(
        source,
        quoteId,
        "2026-09-25",
        finalPdf({ variantName: "Variante A" }),
        actor,
      ),
    ).toThrow("QUOTE_FINAL_PDF_VARIANT_MISMATCH");
    expect(() =>
      markNativeQuoteSentWithFinalPdf(
        source,
        quoteId,
        "2026-09-25",
        finalPdf({ version: 2 }),
        actor,
      ),
    ).toThrow("QUOTE_FINAL_PDF_VERSION_MISMATCH");
  });

  it("refuses to send a quote twice", () => {
    const source = draft();
    const quoteId = source.quotes[0].id;
    const first = markNativeQuoteSent(source, quoteId, "2026-09-25", actor);

    expect(() => markNativeQuoteSent(first.payload, quoteId, "2026-10-01", actor)).toThrow(
      "QUOTE_NOT_EDITABLE",
    );
  });

  it("requires a follow-up date", () => {
    const source = draft();
    expect(() => markNativeQuoteSent(source, source.quotes[0].id, "", actor)).toThrow(
      "QUOTE_FOLLOW_UP_DATE_REQUIRED",
    );
  });
});
