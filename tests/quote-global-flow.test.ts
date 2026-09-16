import { describe, expect, it } from "vitest";
import { createInitialCommercialPayload } from "../src/lib/commercial/domain";
import {
  applyCommercialMutation,
  commercialMutationSchema,
} from "../src/lib/commercial/mutations";
import { startQuoteCommercialWorkflow } from "../src/lib/quotes/commercial-bridge";
import {
  createQuoteVariant,
  createQuoteVersion,
  duplicateQuote,
  quoteIsCurrentVersion,
} from "../src/lib/quotes/lifecycle";
import { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";
import {
  quoteRichTextFromPlainText,
  quoteRichTextToPlainText,
} from "../src/lib/quotes/rich-text";
import { applyQuoteRichTextUpdate } from "../src/lib/quotes/rich-text-mutation";
import {
  createInitialNativeQuotesPayload,
  parseNativeQuotesPayload,
} from "../src/lib/quotes/store";

const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  displayName: "Lucien",
};
const clientId = "22222222-2222-4222-8222-222222222222";

function texts(payload: ReturnType<typeof parseNativeQuotesPayload>, quoteId: string) {
  const quote = payload.quotes.find((item) => item.id === quoteId);
  const line = quote?.model.items.find((item) => item.kind === "LINE");
  if (!line || line.kind !== "LINE") throw new Error("TEST_LINE_NOT_FOUND");
  return {
    plain: line.description,
    rich: quoteRichTextToPlainText(line.presentation?.richText ?? { runs: [] }),
    lineId: line.id,
  };
}

describe("quote global flow", () => {
  it("covers Base V1, quoting, multiline text, V2, variant and duplicate", () => {
    const commercial = applyCommercialMutation(
      createInitialCommercialPayload(),
      commercialMutationSchema.parse({
        action: "create",
        name: "Agencement accueil",
        reviewDate: "2026-09-18",
      }),
      actor,
      new Date("2026-09-16T08:00:00.000Z"),
    );
    const caseId = commercial.focusCaseId!;
    commercial.payload.cases[0].clientId = clientId;

    const quoting = startQuoteCommercialWorkflow(
      commercial.payload,
      caseId,
      "Lucien",
      "2026-09-25",
      actor,
      new Date("2026-09-16T08:05:00.000Z"),
    );
    expect(quoting.payload.cases[0]).toMatchObject({
      status: "CHIFFRAGE",
      quoteOwnerName: "Lucien",
      quoteDueDate: "2026-09-25",
    });

    const base = applyQuotesMutation(
      createInitialNativeQuotesPayload(),
      quotesMutationSchema.parse({
        action: "createDraft",
        commercialCaseId: caseId,
        subject: "Agencement accueil",
        issueDate: "2026-09-16",
        variantName: "Base",
        paymentTerms: "45 jours fin de mois",
      }),
      actor,
      clientId,
      new Date("2026-09-16T08:10:00.000Z"),
    );
    const v1 = base.focusQuoteId;
    expect(base.payload.quotes[0]).toMatchObject({
      variantName: "Base",
      version: 1,
      status: "DRAFT",
    });
    expect(base.payload.quotes[0].model).toMatchObject({
      clientId,
      validityDays: 30,
      paymentTerms: "45 jours fin de mois",
    });

    const withLine = applyQuotesMutation(
      base.payload,
      quotesMutationSchema.parse({
        action: "upsertLine",
        quoteId: v1,
        description: "Meuble vasque",
        unit: "u",
        quantityInput: "1",
        unitPriceCents: 125000,
        saveToLibrary: false,
      }),
      actor,
      undefined,
      new Date("2026-09-16T08:15:00.000Z"),
    );
    const lineId = texts(withLine.payload, v1).lineId;
    const raw = "Meuble vasque\r\nPlan stratifié\r\nPose comprise";
    const expected = "Meuble vasque\nPlan stratifié\nPose comprise";
    const rich = applyQuoteRichTextUpdate(
      withLine.payload,
      {
        quoteId: v1,
        itemId: lineId,
        text: raw,
        richText: quoteRichTextFromPlainText(raw),
      },
      actor,
      new Date("2026-09-16T08:20:00.000Z"),
    );
    const reloaded = parseNativeQuotesPayload(JSON.parse(JSON.stringify(rich)));
    expect(texts(reloaded, v1)).toMatchObject({ plain: expected, rich: expected });

    const versioned = createQuoteVersion(
      reloaded,
      v1,
      actor,
      new Date("2026-09-16T08:30:00.000Z"),
    );
    const v2 = versioned.focusQuoteId;
    expect(versioned.payload.quotes.find((q) => q.id === v1)?.status).toBe("SUPERSEDED");
    expect(versioned.payload.quotes.find((q) => q.id === v2)).toMatchObject({
      variantName: "Base",
      version: 2,
      status: "DRAFT",
    });
    expect(quoteIsCurrentVersion(versioned.payload, v1)).toBe(false);
    expect(quoteIsCurrentVersion(versioned.payload, v2)).toBe(true);
    expect(texts(versioned.payload, v2)).toMatchObject({ plain: expected, rich: expected });
    expect(() =>
      applyQuoteRichTextUpdate(
        versioned.payload,
        {
          quoteId: v1,
          itemId: lineId,
          text: "Interdit",
          richText: quoteRichTextFromPlainText("Interdit"),
        },
        actor,
      ),
    ).toThrow("QUOTE_NOT_EDITABLE");

    const variant = createQuoteVariant(
      versioned.payload,
      v2,
      actor,
      new Date("2026-09-16T08:40:00.000Z"),
    );
    expect(variant.payload.quotes.find((q) => q.id === variant.focusQuoteId)).toMatchObject({
      variantName: "Variante A",
      version: 1,
      commercialCaseId: caseId,
    });
    expect(texts(variant.payload, variant.focusQuoteId).plain).toBe(expected);

    const copy = duplicateQuote(
      variant.payload,
      v2,
      actor,
      new Date("2026-09-16T08:50:00.000Z"),
    );
    expect(copy.payload.quotes.find((q) => q.id === copy.focusQuoteId)).toMatchObject({
      variantName: "Copie de Base",
      version: 1,
      commercialCaseId: caseId,
    });
    expect(texts(copy.payload, copy.focusQuoteId)).toMatchObject({
      plain: expected,
      rich: expected,
    });
  });
});
