import { describe, expect, it } from "vitest";
import { updateDraftQuoteGeneralDetails } from "../src/lib/quotes/general-details";
import { parseNativeQuotesPayload, type NativeQuoteRecord } from "../src/lib/quotes/store";

function quoteRecord({
  id,
  variantName = "Base",
  version = 1,
  status = "DRAFT",
}: {
  id: string;
  variantName?: string;
  version?: number;
  status?: NativeQuoteRecord["status"];
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
      validityDays: 30,
      paymentTerms: "45 jours fin de mois",
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
  variantName: "Variante A",
  issueDate: "2026-09-16",
  validityDays: 45,
  paymentTerms: "30 jours fin de mois",
};

describe("quote general details", () => {
  it("modifie uniquement les informations générales d'un brouillon", () => {
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
    expect(updated.variantName).toBe("Variante A");
    expect(updated.model.subject).toBe("Agencement accueil principal");
    expect(updated.model.issueDate).toBe("2026-09-16");
    expect(updated.model.validityDays).toBe(45);
    expect(updated.model.paymentTerms).toBe("30 jours fin de mois");
    expect(updated.commercialCaseId).toBe(source.quotes[0].commercialCaseId);
    expect(updated.model.clientId).toBe(source.quotes[0].model.clientId);
    expect(updated.version).toBe(1);
    expect(updated.status).toBe("DRAFT");
    expect(updated.updatedByName).toBe("Nadia");
    expect(updated.updatedAt).toBe("2026-09-15T12:30:00.000Z");
    expect(source.quotes[0].variantName).toBe("Base");
  });

  it("refuse de modifier un devis qui n'est plus brouillon", () => {
    const quoteId = "22222222-2222-4222-8222-222222222222";
    const source = parseNativeQuotesPayload({
      schemaVersion: 1,
      quotes: [quoteRecord({ id: quoteId, status: "SENT" })],
    });

    expect(() =>
      updateDraftQuoteGeneralDetails(source, quoteId, updatedDetails, { displayName: "Nadia" }),
    ).toThrow("QUOTE_NOT_EDITABLE");
  });

  it("refuse un nom de variante qui créerait le même couple variante/version", () => {
    const quoteId = "33333333-3333-4333-8333-333333333333";
    const source = parseNativeQuotesPayload({
      schemaVersion: 1,
      quotes: [
        quoteRecord({ id: quoteId, variantName: "Base", version: 1 }),
        quoteRecord({
          id: "44444444-4444-4444-8444-444444444444",
          variantName: "Variante A",
          version: 1,
        }),
      ],
    });

    expect(() =>
      updateDraftQuoteGeneralDetails(
        source,
        quoteId,
        { ...updatedDetails, variantName: "variante a" },
        { displayName: "Nadia" },
      ),
    ).toThrow("QUOTE_VARIANT_VERSION_CONFLICT");
  });
});
