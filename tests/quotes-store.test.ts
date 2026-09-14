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
