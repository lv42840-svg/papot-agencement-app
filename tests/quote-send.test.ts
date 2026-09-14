import { describe, expect, it } from "vitest";
import { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";
import { markNativeQuoteSent } from "../src/lib/quotes/send";
import { createInitialNativeQuotesPayload } from "../src/lib/quotes/store";

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
      updatedByName: "Lucien",
    });
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
