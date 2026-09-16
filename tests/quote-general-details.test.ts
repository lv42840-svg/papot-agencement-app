import { describe, expect, it } from "vitest";
import { quoteValidityDate } from "../src/lib/quotes/domain";
import {
  quoteGeneralDetailsSchema,
  updateDraftQuoteGeneralDetails,
} from "../src/lib/quotes/general-details";
import { parseNativeQuotesPayload, type NativeQuoteRecord } from "../src/lib/quotes/store";

function quoteRecord({
  id,
  variantName = "Base",
  version = 1,
  status = "DRAFT",
  validityDays = 30,
  paymentTerms = "45 jours fin de mois",
}: {
  id: string;
  variantName?: string;
  version?: number;
  status?: NativeQuoteRecord["status"];
  validityDays?: number;
  paymentTerms?: string;
}) {
  return {
    id,
    commercialCaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    variantName,
    version,
    status,
    model: {
      id,
      clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      subject: "Agencement accueil",
      issueDate: "2026-09-15",
      validityDays,
      paymentTerms,
      items: [],
    },
    createdAt: "2026-09-15T08:00:00.000Z",
    createdByName: "Lucien",
    updatedAt: "2026-09-15T08:00:00.000Z",
    updatedByName: "Lucien",
  };
}

const updatedDetails = {
  subject: "Agencement accueil principal",
  issueDate: "2026-09-16",
  paymentTerms: "30 jours fin de mois",
};

describe("quote general details", () => {
  it("modifie uniquement les paramètres encore éditables d'un brouillon", () => {
    const quoteId = "11111111-1111-4111-8111-111111111111";
    const source = parseNativeQuotesPayload({
      schemaVersion: 1,
      quotes: [quoteRecord({ id: quoteId })],
    });

    const result = updateDraftQuoteGeneralDetails(
      source,
      quoteId,
      updatedDetails,
      { displayName: "Nadia" },
      new Date("2026-09-15T12:30:00.000Z"),
    );

    const updated = result.payload.quotes[0];
    expect(updated.variantName).toBe("Base");
    expect(updated.model.subject).toBe("Agencement accueil principal");
    expect(updated.model.issueDate).toBe("2026-09-16");
    expect(updated.model.validityDays).toBe(30);
    expect(updated.model.paymentTerms).toBe("30 jours fin de mois");
    expect(updated.commercialCaseId).toBe(source.quotes[0].commercialCaseId);
    expect(updated.model.clientId).toBe(source.quotes[0].model.clientId);
    expect(updated.version).toBe(1);
    expect(updated.status).toBe("DRAFT");
    expect(updated.updatedByName).toBe("Nadia");
    expect(updated.updatedAt).toBe("2026-09-15T12:30:00.000Z");
    expect(source.quotes[0].variantName).toBe("Base");
  });

  it("refuse les anciens champs libres variante et validité dans cette mutation", () => {
    expect(
      quoteGeneralDetailsSchema.safeParse({
        ...updatedDetails,
        variantName: "Variante libre",
      }).success,
    ).toBe(false);
    expect(
      quoteGeneralDetailsSchema.safeParse({
        ...updatedDetails,
        validityDays: 45,
      }).success,
    ).toBe(false);
  });

  it("conserve la validité métier à 30 jours quand la date du devis change", () => {
    const quoteId = "55555555-5555-4555-8555-555555555555";
    const source = parseNativeQuotesPayload({
      schemaVersion: 1,
      quotes: [quoteRecord({ id: quoteId, validityDays: 45 })],
    });
    const result = updateDraftQuoteGeneralDetails(source, quoteId, updatedDetails, {
      displayName: "Nadia",
    });

    const updated = result.payload.quotes[0];
    expect(updated.model.issueDate).toBe("2026-09-16");
    expect(updated.model.validityDays).toBe(30);
    expect(quoteValidityDate(updated.model.issueDate, updated.model.validityDays)).toBe(
      "2026-10-16",
    );
  });

  it("charge un ancien devis sans erreur et normalise sa validité à 30 jours", () => {
    const quoteId = "66666666-6666-4666-8666-666666666666";
    const parsed = parseNativeQuotesPayload({
      schemaVersion: 1,
      quotes: [
        quoteRecord({
          id: quoteId,
          variantName: "Base",
          validityDays: 45,
          paymentTerms: "Comptant",
        }),
      ],
    });

    expect(parsed.quotes[0].variantName).toBe("Base");
    expect(parsed.quotes[0].model.validityDays).toBe(30);
    expect(parsed.quotes[0].model.paymentTerms).toBe("Comptant");
  });

  it("refuse de modifier un devis qui n'est plus brouillon", () => {
    const quoteId = "22222222-2222-4222-8222-222222222222";
    const source = parseNativeQuotesPayload({
      schemaVersion: 1,
      quotes: [quoteRecord({ id: quoteId, status: "SENT" })],
    });

    expect(() =>
      updateDraftQuoteGeneralDetails(source, quoteId, updatedDetails, {
        displayName: "Nadia",
      }),
    ).toThrow("QUOTE_NOT_EDITABLE");
  });
});
