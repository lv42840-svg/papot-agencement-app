import { describe, expect, it } from "vitest";
import {
  applyQuoteLegalDetailsMutation,
  initializeQuoteVatFromClient,
  quoteHasCompleteWorkSchedule,
  resolveQuoteLineVatRate,
} from "../src/lib/quotes/legal-details";
import { parseNativeQuotesPayload } from "../src/lib/quotes/store";

const actor = { displayName: "Nadia" };
const quoteId = "11111111-1111-4111-8111-111111111111";
const lineId = "22222222-2222-4222-8222-222222222222";

function legacyPayload(status = "DRAFT") {
  return parseNativeQuotesPayload({
    schemaVersion: 1,
    quotes: [
      {
        id: quoteId,
        commercialCaseId: "33333333-3333-4333-8333-333333333333",
        variantName: "Base",
        version: 1,
        status,
        model: {
          id: quoteId,
          clientId: "44444444-4444-4444-8444-444444444444",
          subject: "Agencement accueil",
          issueDate: "2026-09-17",
          validityDays: 30,
          paymentTerms: "45 jours fin de mois",
          items: [
            {
              id: lineId,
              kind: "LINE",
              parentId: null,
              description: "Banque d'accueil",
              unit: "u",
              quantity: 1,
              quantityFormula: null,
              unitPriceCents: 125000,
            },
          ],
        },
        createdAt: "2026-09-17T06:00:00.000Z",
        createdByName: "Lucien",
        updatedAt: "2026-09-17T06:00:00.000Z",
        updatedByName: "Lucien",
      },
    ],
  });
}

describe("quote legal details", () => {
  it("migre un ancien devis avec une TVA par défaut et des délais encore vides", () => {
    const quote = legacyPayload().quotes[0];
    expect(quote.taxConfig).toEqual({ defaultRatePercent: 20, lineOverrides: [] });
    expect(quote.workSchedule).toEqual({ startDate: null, duration: "", endDate: null });
    expect(quoteHasCompleteWorkSchedule(quote)).toBe(false);
  });

  it("fige le taux de la fiche client sur le devis au démarrage", () => {
    const result = initializeQuoteVatFromClient(
      legacyPayload(),
      quoteId,
      10,
      actor,
      new Date("2026-09-17T06:30:00.000Z"),
    );
    const quote = result.payload.quotes[0];
    expect(quote.taxConfig.defaultRatePercent).toBe(10);
    expect(resolveQuoteLineVatRate(quote, lineId)).toBe(10);
  });

  it("autorise un taux spécifique par ligne puis le retour au taux client", () => {
    const initialized = initializeQuoteVatFromClient(legacyPayload(), quoteId, 20, actor);
    const overridden = applyQuoteLegalDetailsMutation(
      initialized.payload,
      quoteId,
      { action: "setLineVatRate", lineId, ratePercent: 5.5 },
      actor,
    );
    expect(resolveQuoteLineVatRate(overridden.payload.quotes[0], lineId)).toBe(5.5);
    expect(overridden.payload.quotes[0].taxConfig.lineOverrides).toEqual([
      { lineId, ratePercent: 5.5 },
    ]);

    const reset = applyQuoteLegalDetailsMutation(
      overridden.payload,
      quoteId,
      { action: "setLineVatRate", lineId, ratePercent: null },
      actor,
    );
    expect(resolveQuoteLineVatRate(reset.payload.quotes[0], lineId)).toBe(20);
    expect(reset.payload.quotes[0].taxConfig.lineOverrides).toEqual([]);
  });

  it("enregistre les trois données travaux nécessaires au futur PDF", () => {
    const result = applyQuoteLegalDetailsMutation(
      legacyPayload(),
      quoteId,
      {
        action: "updateWorkSchedule",
        schedule: {
          startDate: "2026-10-05",
          duration: "3 semaines",
          endDate: "2026-10-23",
        },
      },
      actor,
    );

    expect(result.payload.quotes[0].workSchedule).toEqual({
      startDate: "2026-10-05",
      duration: "3 semaines",
      endDate: "2026-10-23",
    });
    expect(quoteHasCompleteWorkSchedule(result.payload.quotes[0])).toBe(true);
  });

  it("refuse une fin de travaux antérieure au début", () => {
    expect(() =>
      applyQuoteLegalDetailsMutation(
        legacyPayload(),
        quoteId,
        {
          action: "updateWorkSchedule",
          schedule: {
            startDate: "2026-10-20",
            duration: "2 semaines",
            endDate: "2026-10-10",
          },
        },
        actor,
      ),
    ).toThrow();
  });

  it("refuse de modifier les données d'un devis qui n'est plus brouillon", () => {
    expect(() =>
      applyQuoteLegalDetailsMutation(
        legacyPayload("SENT"),
        quoteId,
        {
          action: "updateWorkSchedule",
          schedule: {
            startDate: "2026-10-05",
            duration: "3 semaines",
            endDate: "2026-10-23",
          },
        },
        actor,
      ),
    ).toThrow("QUOTE_NOT_EDITABLE");
  });
});
