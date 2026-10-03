import { describe, expect, it } from "vitest";
import { updateDraftQuoteInternalNotes } from "../src/lib/quotes/internal-notes";
import { parseNativeQuotesPayload, type NativeQuoteRecord } from "../src/lib/quotes/store";

function quoteRecord(status: NativeQuoteRecord["status"] = "DRAFT") {
  const id = "11111111-1111-4111-8111-111111111111";
  return {
    id,
    commercialCaseId: "22222222-2222-4222-8222-222222222222",
    variantName: "Base",
    version: 1,
    status,
    model: {
      id,
      clientId: "33333333-3333-4333-8333-333333333333",
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

describe("quote internal notes", () => {
  it("lit les anciens devis avec une zone de notes vide", () => {
    const payload = parseNativeQuotesPayload({ schemaVersion: 1, quotes: [quoteRecord()] });

    expect(payload.quotes[0].internalNotes).toBe("");
  });

  it("enregistre une note interne sans modifier le modèle client du devis", () => {
    const source = parseNativeQuotesPayload({ schemaVersion: 1, quotes: [quoteRecord()] });
    const originalModel = structuredClone(source.quotes[0].model);

    const result = updateDraftQuoteInternalNotes(
      source,
      source.quotes[0].id,
      { internalNotes: "Ligne 1.2 : prévoir des bananes\nVérifier la finition." },
      { displayName: "Nadia" },
      new Date("2026-09-15T14:00:00.000Z"),
    );

    expect(result.payload.quotes[0].internalNotes).toBe(
      "Ligne 1.2 : prévoir des bananes\nVérifier la finition.",
    );
    expect(result.payload.quotes[0].model).toEqual(originalModel);
    expect(result.payload.quotes[0].updatedByName).toBe("Nadia");
    expect(result.payload.quotes[0].updatedAt).toBe("2026-09-15T14:00:00.000Z");
    expect(source.quotes[0].internalNotes).toBe("");
  });

  it("refuse de modifier les notes d'un devis qui n'est plus brouillon", () => {
    const source = parseNativeQuotesPayload({ schemaVersion: 1, quotes: [quoteRecord("SENT")] });

    expect(() =>
      updateDraftQuoteInternalNotes(
        source,
        source.quotes[0].id,
        { internalNotes: "Note après envoi" },
        { displayName: "Nadia" },
      ),
    ).toThrow("QUOTE_NOT_EDITABLE");
  });
});
