import { describe, expect, it } from "vitest";
import {
  createQuoteVariant,
  createQuoteVersion,
  duplicateQuote,
  quoteIsCurrentVersion,
} from "../src/lib/quotes/lifecycle";
import { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";
import { markNativeQuoteSentWithFinalPdf } from "../src/lib/quotes/send";
import { createInitialNativeQuotesPayload, type QuoteFinalPdf } from "../src/lib/quotes/store";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};
const affairId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";

function draft() {
  const payload = applyQuotesMutation(
    createInitialNativeQuotesPayload(),
    quotesMutationSchema.parse({
      action: "createDraft",
      commercialCaseId: affairId,
      subject: "Agencement accueil",
      issueDate: "2026-09-16",
      variantName: "Base",
      paymentTerms: "45 jours fin de mois",
    }),
    actor,
    clientId,
    new Date("2026-09-16T12:00:00.000Z"),
  ).payload;
  payload.quotes[0].internalNotes = "Marge validée avec Nadia";
  payload.quotes[0].pricingConfig.adjustments.push({
    id: "44444444-4444-4444-8444-444444444444",
    kind: "PERCENTAGE",
    label: "Commission architecte",
    active: true,
    applyToOptions: true,
    marginTreatment: "PASS_THROUGH",
    percent: 5,
  });
  return payload;
}

function finalPdf(): QuoteFinalPdf {
  return {
    quoteNumber: "D-2026-0001",
    variantName: "Base",
    version: 1,
    commercialDocumentId: "55555555-5555-4555-8555-555555555555",
    fileName: "Devis D-2026-0001 - Base - V1.pdf",
    storagePath: "Commercial/2026/TEST/Devis/Devis D-2026-0001 - Base - V1.pdf",
    sizeBytes: 1234,
    sha256: "a".repeat(64),
    archivedAt: "2026-09-16T12:30:00.000Z",
    archivedByName: "Lucien",
  };
}

describe("quote lifecycle", () => {
  it("cree V2 en copie complete et verrouille V1 comme version precedente", () => {
    const source = draft();
    const firstId = source.quotes[0].id;
    const result = createQuoteVersion(source, firstId, actor, new Date("2026-09-16T13:00:00.000Z"));
    const previous = result.payload.quotes.find((quote) => quote.id === firstId);
    const current = result.payload.quotes.find((quote) => quote.id === result.focusQuoteId);

    expect(previous?.status).toBe("SUPERSEDED");
    expect(current).toMatchObject({
      variantName: "Base",
      version: 2,
      status: "DRAFT",
      internalNotes: "Marge validée avec Nadia",
      sentAt: null,
      followUpDate: null,
      finalPdf: null,
    });
    expect(current?.pricingConfig).toEqual(source.quotes[0].pricingConfig);
    expect(current?.model.subject).toBe(source.quotes[0].model.subject);
    expect(current?.id).not.toBe(firstId);
    expect(current?.model.id).toBe(current?.id);
    expect(quoteIsCurrentVersion(result.payload, firstId)).toBe(false);
    expect(quoteIsCurrentVersion(result.payload, result.focusQuoteId)).toBe(true);
  });

  it("conserve le PDF fige de V1 mais ne le recopie jamais dans V2", () => {
    const source = draft();
    const firstId = source.quotes[0].id;
    const sent = markNativeQuoteSentWithFinalPdf(
      source,
      firstId,
      "2026-09-30",
      finalPdf(),
      actor,
      new Date("2026-09-16T12:30:00.000Z"),
    );
    const result = createQuoteVersion(
      sent.payload,
      firstId,
      actor,
      new Date("2026-09-16T13:00:00.000Z"),
    );
    const previous = result.payload.quotes.find((quote) => quote.id === firstId);
    const current = result.payload.quotes.find((quote) => quote.id === result.focusQuoteId);

    expect(previous?.status).toBe("SUPERSEDED");
    expect(previous?.finalPdf?.quoteNumber).toBe("D-2026-0001");
    expect(current).toMatchObject({ status: "DRAFT", version: 2, finalPdf: null });
  });

  it("refuse de repartir d'une ancienne version", () => {
    const source = draft();
    const firstId = source.quotes[0].id;
    const v2 = createQuoteVersion(source, firstId, actor);
    expect(() => createQuoteVersion(v2.payload, firstId, actor)).toThrow(
      "QUOTE_VERSION_SOURCE_OUTDATED",
    );
  });

  it("cree automatiquement Variante A V1 sans modifier Base", () => {
    const source = draft();
    const firstId = source.quotes[0].id;
    const result = createQuoteVariant(source, firstId, actor);
    const variant = result.payload.quotes.find((quote) => quote.id === result.focusQuoteId);

    expect(result.payload.quotes.find((quote) => quote.id === firstId)?.status).toBe("DRAFT");
    expect(variant).toMatchObject({ variantName: "Variante A", version: 1, status: "DRAFT" });
  });

  it("duplique dans une copie independante nommee sans texte libre", () => {
    const source = draft();
    const result = duplicateQuote(source, source.quotes[0].id, actor);
    const copy = result.payload.quotes.find((quote) => quote.id === result.focusQuoteId);

    expect(copy).toMatchObject({ variantName: "Copie de Base", version: 1, status: "DRAFT" });
    expect(copy?.pricingConfig).toEqual(source.quotes[0].pricingConfig);
  });
});
