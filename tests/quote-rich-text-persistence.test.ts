import { describe, expect, it } from "vitest";
import { createQuoteVersion } from "../src/lib/quotes/lifecycle";
import { quoteRichTextFromPlainText, quoteRichTextToPlainText } from "../src/lib/quotes/rich-text";
import { applyQuoteRichTextUpdate } from "../src/lib/quotes/rich-text-mutation";
import { parseNativeQuotesPayload } from "../src/lib/quotes/store";

const QUOTE_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const LINE_ID = "44444444-4444-4444-8444-444444444444";

const actor = {
  userId: "55555555-5555-4555-8555-555555555555",
  displayName: "Lucien",
};

function draft() {
  return parseNativeQuotesPayload({
    schemaVersion: 1,
    quotes: [
      {
        id: QUOTE_ID,
        commercialCaseId: CASE_ID,
        variantName: "Base",
        version: 1,
        status: "DRAFT",
        model: {
          id: QUOTE_ID,
          clientId: CLIENT_ID,
          subject: "Agencement accueil",
          issueDate: "2026-09-16",
          validityDays: 30,
          paymentTerms: "45 jours fin de mois",
          items: [
            {
              id: LINE_ID,
              kind: "LINE",
              parentId: null,
              description: "Meuble vasque",
              unit: "u",
              quantity: 1,
              quantityFormula: null,
              unitPriceCents: 10000,
              presentation: { photos: [] },
            },
          ],
        },
        createdAt: "2026-09-16T12:00:00.000Z",
        createdByName: "Lucien",
        updatedAt: "2026-09-16T12:00:00.000Z",
        updatedByName: "Lucien",
      },
    ],
  });
}

describe("quote rich-text line-break persistence", () => {
  it("keeps explicit line breaks after save, reload and creation of V2", () => {
    const inputText = "Meuble vasque\r\nPlan stratifié\r\nPose comprise";
    const expectedText = "Meuble vasque\nPlan stratifié\nPose comprise";
    const updated = applyQuoteRichTextUpdate(
      draft(),
      {
        quoteId: QUOTE_ID,
        itemId: LINE_ID,
        text: inputText,
        richText: quoteRichTextFromPlainText(inputText),
      },
      actor,
      new Date("2026-09-16T13:00:00.000Z"),
    );

    const reloaded = parseNativeQuotesPayload(JSON.parse(JSON.stringify(updated)));
    const savedLine = reloaded.quotes[0].model.items.find((item) => item.id === LINE_ID);
    expect(savedLine?.kind).toBe("LINE");
    if (!savedLine || savedLine.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");
    expect(savedLine.description).toBe(expectedText);
    expect(quoteRichTextToPlainText(savedLine.presentation?.richText ?? { runs: [] })).toBe(
      expectedText,
    );

    const versioned = createQuoteVersion(
      reloaded,
      QUOTE_ID,
      actor,
      new Date("2026-09-16T14:00:00.000Z"),
    );
    const v2 = versioned.payload.quotes.find((quote) => quote.id === versioned.focusQuoteId);
    const copiedLine = v2?.model.items.find((item) => item.id === LINE_ID);
    expect(copiedLine?.kind).toBe("LINE");
    if (!copiedLine || copiedLine.kind !== "LINE") throw new Error("TEST_COPIED_LINE_NOT_FOUND");
    expect(copiedLine.description).toBe(expectedText);
    expect(quoteRichTextToPlainText(copiedLine.presentation?.richText ?? { runs: [] })).toBe(
      expectedText,
    );
  });
});
