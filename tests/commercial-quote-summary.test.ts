import { describe, expect, it } from "vitest";
import { calculateCommercialQuoteSummary } from "../src/lib/quotes/commercial-summary";
import { nativeQuoteRecordSchema } from "../src/lib/quotes/store";

const affairId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const quoteId = "33333333-3333-4333-8333-333333333333";
const mainLineId = "44444444-4444-4444-8444-444444444444";
const optionLineId = "55555555-5555-4555-8555-555555555555";

describe("commercial quote summary", () => {
  it("reuses quote pricing and counts sold BE, atelier and pose hours without pending options", () => {
    const quote = nativeQuoteRecordSchema.parse({
      id: quoteId,
      commercialCaseId: affairId,
      variantName: "Base",
      version: 2,
      status: "DRAFT",
      model: {
        id: quoteId,
        clientId,
        subject: "Banque accueil",
        issueDate: "2026-09-18",
        validityDays: 30,
        paymentTerms: "45 jours fin de mois",
        items: [
          {
            id: mainLineId,
            kind: "LINE",
            parentId: null,
            description: "Mobilier principal",
            unit: "u",
            quantity: 2,
            quantityFormula: null,
            unitPriceCents: 31_000,
            components: [
              {
                id: "12121212-1212-4212-8212-121212121212",
                description: "Matière",
                unit: "u",
                quantity: 1,
                quantityFormula: null,
                costPriceCents: 4_000,
                unitPriceCents: 5_000,
              },
              {
                id: "66666666-6666-4666-8666-666666666666",
                description: "Heure BE",
                unit: "h",
                quantity: 1,
                quantityFormula: null,
                activity: "BE",
                costPriceCents: 1_000,
                unitPriceCents: 2_000,
              },
              {
                id: "77777777-7777-4777-8777-777777777777",
                description: "Heure atelier",
                unit: "h",
                quantity: 3,
                quantityFormula: null,
                activity: "ATELIER",
                costPriceCents: 2_000,
                unitPriceCents: 4_000,
              },
              {
                id: "88888888-8888-4888-8888-888888888888",
                description: "Heure pose",
                unit: "h",
                quantity: 2,
                quantityFormula: null,
                activity: "POSE",
                costPriceCents: 3_000,
                unitPriceCents: 6_000,
              },
            ],
          },
          {
            id: optionLineId,
            kind: "LINE",
            parentId: null,
            description: "Option non retenue",
            unit: "u",
            quantity: 1,
            quantityFormula: null,
            unitPriceCents: 15_000,
            components: [
              {
                id: "99999999-9999-4999-8999-999999999999",
                description: "Heure atelier option",
                unit: "h",
                quantity: 10,
                quantityFormula: null,
                activity: "ATELIER",
                costPriceCents: 1_000,
                unitPriceCents: 1_500,
              },
            ],
          },
        ],
      },
      pricingConfig: {
        adjustments: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            kind: "POSE_HOURS",
            label: "Déplacement chantier",
            active: true,
            applyToOptions: false,
            marginTreatment: "MARGED",
            hours: 2,
          },
        ],
        options: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            targetItemId: optionLineId,
            targetKind: "LINE",
            label: "Option",
            status: "PENDING",
          },
        ],
      },
      createdAt: "2026-09-18T05:00:00.000Z",
      createdByName: "Lucien",
      updatedAt: "2026-09-18T05:00:00.000Z",
      updatedByName: "Lucien",
    });

    expect(calculateCommercialQuoteSummary(quote)).toEqual({
      totalHtCents: 74_000,
      soldHours: 14,
      soldHoursByActivity: {
        be: 2,
        workshop: 6,
        install: 6,
        total: 14,
      },
      plannedDisbursementCents: 8_000,
      plannedMarginCents: 34_000,
    });
  });

  it("does not invent a planned cost when the quote cost is incomplete", () => {
    const quote = nativeQuoteRecordSchema.parse({
      id: quoteId,
      commercialCaseId: affairId,
      variantName: "Base",
      version: 1,
      status: "DRAFT",
      model: {
        id: quoteId,
        clientId,
        subject: "Ancien devis",
        issueDate: "2026-09-18",
        validityDays: 30,
        paymentTerms: "45 jours fin de mois",
        items: [
          {
            id: mainLineId,
            kind: "LINE",
            parentId: null,
            description: "Ligne sans déboursé détaillé",
            unit: "u",
            quantity: 1,
            quantityFormula: null,
            unitPriceCents: 10_000,
          },
        ],
      },
      createdAt: "2026-09-18T05:00:00.000Z",
      createdByName: "Lucien",
      updatedAt: "2026-09-18T05:00:00.000Z",
      updatedByName: "Lucien",
    });

    expect(calculateCommercialQuoteSummary(quote)).toEqual({
      totalHtCents: 10_000,
      soldHours: 0,
      soldHoursByActivity: {
        be: 0,
        workshop: 0,
        install: 0,
        total: 0,
      },
      plannedDisbursementCents: null,
      plannedMarginCents: null,
    });
  });
});
