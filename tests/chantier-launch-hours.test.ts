import { describe, expect, it } from "vitest";
import { deriveChantierLaunchHours } from "../src/lib/chantiers/launch-hours";
import { nativeQuoteRecordSchema } from "../src/lib/quotes/store";

const affairId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const quoteId = "44444444-4444-4444-8444-444444444444";

function laborQuote() {
  return nativeQuoteRecordSchema.parse({
    id: quoteId,
    commercialCaseId: affairId,
    quoteKind: "STANDARD",
    variantName: "Base",
    version: 1,
    status: "ACCEPTED",
    sentAt: "2026-09-20T08:00:00.000Z",
    followUpDate: null,
    finalPdf: {
      quoteNumber: "D-2026-0001",
      variantName: "Base",
      version: 1,
      commercialDocumentId: crypto.randomUUID(),
      fileName: "devis.pdf",
      storagePath: "Commercial/devis.pdf",
      sizeBytes: 100,
      sha256: "a".repeat(64),
      archivedAt: "2026-09-20T08:00:00.000Z",
      archivedByName: "Lucien",
    },
    pricingConfig: { adjustments: [], options: [] },
    model: {
      id: quoteId,
      clientId,
      subject: "Agencement",
      issueDate: "2026-09-20",
      validityDays: 30,
      paymentTerms: "45 jours fin de mois",
      items: [
        {
          id: crypto.randomUUID(),
          kind: "LINE",
          parentId: null,
          description: "Ouvrage",
          unit: "u",
          quantity: 2,
          quantityFormula: null,
          unitPriceCents: 100_000,
          components: [
            {
              id: crypto.randomUUID(),
              description: "BE",
              unit: "h",
              quantity: 1.5,
              quantityFormula: null,
              activity: "BE",
              costPriceCents: 2_000,
              unitPriceCents: 4_000,
            },
            {
              id: crypto.randomUUID(),
              description: "Atelier",
              unit: "h",
              quantity: 4,
              quantityFormula: null,
              activity: "ATELIER",
              costPriceCents: 3_000,
              unitPriceCents: 5_000,
            },
            {
              id: crypto.randomUUID(),
              description: "Pose",
              unit: "h",
              quantity: 2.5,
              quantityFormula: null,
              activity: "POSE",
              costPriceCents: 4_000,
              unitPriceCents: 7_000,
            },
          ],
        },
      ],
    },
    createdAt: "2026-09-20T07:00:00.000Z",
    createdByName: "Lucien",
    updatedAt: "2026-09-20T08:00:00.000Z",
    updatedByName: "Lucien",
  });
}

describe("chantier launch hours", () => {
  it("uses sold BE, workshop and install hours from retained native quotes", () => {
    const result = deriveChantierLaunchHours(
      {
        id: affairId,
        retainedQuoteIds: [quoteId],
        provisionHours: { be: 99, workshop: 99, install: 99 },
      },
      { schemaVersion: 1, quotes: [laborQuote()] },
    );

    expect(result.source).toBe("RETAINED_QUOTES");
    expect(result.hours).toEqual({ be: 3, workshop: 8, install: 5 });
  });

  it("falls back to commercial provision only when no native quote is retained", () => {
    const result = deriveChantierLaunchHours(
      {
        id: affairId,
        retainedQuoteIds: [],
        provisionHours: { be: 2, workshop: 10, install: 6 },
      },
      { schemaVersion: 1, quotes: [] },
    );

    expect(result).toEqual({
      source: "COMMERCIAL_PROVISION",
      hours: { be: 2, workshop: 10, install: 6 },
    });
  });

  it("refuses to invent zero hours when a retained quote cannot be resolved", () => {
    expect(() =>
      deriveChantierLaunchHours(
        {
          id: affairId,
          retainedQuoteIds: [quoteId],
          provisionHours: { be: 0, workshop: 0, install: 0 },
        },
        { schemaVersion: 1, quotes: [] },
      ),
    ).toThrow("CHANTIER_RETAINED_QUOTE_NOT_FOUND");
  });
});
