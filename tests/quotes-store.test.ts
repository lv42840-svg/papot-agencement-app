import { describe, expect, it } from "vitest";
import { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";
import {
  createInitialNativeQuotesPayload,
  parseNativeQuotesPayload,
} from "../src/lib/quotes/store";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};
const affairId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";

function draftInput(variantName?: string) {
  return quotesMutationSchema.parse({
    action: "createDraft",
    commercialCaseId: affairId,
    subject: "Agencement accueil",
    issueDate: "2026-09-14",
    variantName,
    paymentTerms: "30 jours",
  });
}

describe("native quote draft store", () => {
  it("creates an unnumbered V1 draft attached to the affair and client", () => {
    const result = applyQuotesMutation(
      createInitialNativeQuotesPayload(),
      draftInput(),
      actor,
      clientId,
      new Date("2026-09-14T16:30:00.000Z"),
    );
    const quote = result.payload.quotes[0];

    expect(quote).toMatchObject({
      commercialCaseId: affairId,
      variantName: "Base",
      version: 1,
      status: "DRAFT",
      finalPdf: null,
      createdByName: "Lucien",
      updatedByName: "Lucien",
      model: {
        clientId,
        subject: "Agencement accueil",
        issueDate: "2026-09-14",
        validityDays: 30,
        paymentTerms: "30 jours",
        items: [],
      },
    });
    expect(quote.id).toBe(quote.model.id);
    expect(result.focusQuoteId).toBe(quote.id);
    expect("quoteNumber" in quote).toBe(false);
  });

  it("increments versions inside the same affair and variant", () => {
    const first = applyQuotesMutation(
      createInitialNativeQuotesPayload(),
      draftInput("Base"),
      actor,
      clientId,
    );
    const second = applyQuotesMutation(first.payload, draftInput("base"), actor, clientId);

    expect(second.payload.quotes.map((quote) => quote.version)).toEqual([1, 2]);
  });

  it("starts another variant at V1", () => {
    const first = applyQuotesMutation(
      createInitialNativeQuotesPayload(),
      draftInput("Base"),
      actor,
      clientId,
    );
    const second = applyQuotesMutation(first.payload, draftInput("Variante A"), actor, clientId);

    expect(second.payload.quotes[1]).toMatchObject({ variantName: "Variante A", version: 1 });
  });

  it("still reads a stored legacy quote that has no final PDF field", () => {
    const created = applyQuotesMutation(
      createInitialNativeQuotesPayload(),
      draftInput(),
      actor,
      clientId,
    ).payload;
    const legacy = structuredClone(created) as unknown as {
      quotes: Array<Record<string, unknown>>;
    };
    delete legacy.quotes[0].finalPdf;

    expect(parseNativeQuotesPayload(legacy).quotes[0].finalPdf).toBeNull();
  });

  it("still reads a stored legacy line that has no components field", () => {
    const created = applyQuotesMutation(
      createInitialNativeQuotesPayload(),
      draftInput(),
      actor,
      clientId,
    );
    const withLine = applyQuotesMutation(
      created.payload,
      quotesMutationSchema.parse({
        action: "upsertLine",
        quoteId: created.focusQuoteId,
        description: "Ancienne ligne",
        unit: "u",
        quantityInput: "1",
        unitPriceCents: 10_000,
      }),
      actor,
    ).payload;

    const legacy = structuredClone(withLine) as unknown as {
      quotes: Array<{ model: { items: Array<Record<string, unknown>> } }>;
    };
    delete legacy.quotes[0].model.items[0].components;

    const parsed = parseNativeQuotesPayload(legacy);
    expect(parsed.quotes[0].model.items[0]).toMatchObject({
      kind: "LINE",
      description: "Ancienne ligne",
      unitPriceCents: 10_000,
    });
    expect("components" in parsed.quotes[0].model.items[0]).toBe(false);
  });

  it("refuses final PDF metadata on a draft or from another variant", () => {
    const created = applyQuotesMutation(
      createInitialNativeQuotesPayload(),
      draftInput(),
      actor,
      clientId,
    ).payload;
    const broken = structuredClone(created) as unknown as {
      quotes: Array<Record<string, unknown>>;
    };
    broken.quotes[0].finalPdf = {
      quoteNumber: "D-2026-0001",
      variantName: "Variante A",
      version: 1,
      commercialDocumentId: "44444444-4444-4444-8444-444444444444",
      fileName: "Devis D-2026-0001 - Variante A - V1.pdf",
      storagePath: "Commercial/2026/TEST/Devis/test.pdf",
      sizeBytes: 100,
      sha256: "a".repeat(64),
      archivedAt: "2026-09-17T20:00:00.000Z",
      archivedByName: "TEST",
    };

    expect(() => parseNativeQuotesPayload(broken)).toThrow("QUOTES_STORE_INVALID");
  });

  it("refuses a stored record whose wrapper and quote model ids diverge", () => {
    const created = applyQuotesMutation(
      createInitialNativeQuotesPayload(),
      draftInput(),
      actor,
      clientId,
    ).payload;
    const broken = structuredClone(created) as unknown as {
      quotes: Array<{ model: { id: string } }>;
    };
    broken.quotes[0].model.id = "44444444-4444-4444-8444-444444444444";

    expect(() => parseNativeQuotesPayload(broken)).toThrow("QUOTES_STORE_INVALID");
  });
});
