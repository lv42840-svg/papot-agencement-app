import { describe, expect, it } from "vitest";
import { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";
import { createInitialNativeQuotesPayload } from "../src/lib/quotes/store";
import {
  registerQuoteItemPhotos,
  removeQuoteItemPhoto,
  setQuoteItemPhotoVisibility,
} from "../src/lib/quotes/item-photos";

const actor = { userId: "11111111-1111-4111-8111-111111111111", displayName: "Lucien" };
const affairId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";

function draft() {
  return applyQuotesMutation(
    createInitialNativeQuotesPayload(),
    quotesMutationSchema.parse({
      action: "createDraft",
      commercialCaseId: affairId,
      subject: "Test présentation",
      issueDate: "2026-09-16",
      paymentTerms: "45 jours fin de mois",
    }),
    actor,
    clientId,
  );
}

function withSection() {
  const created = draft();
  return applyQuotesMutation(
    created.payload,
    quotesMutationSchema.parse({
      action: "upsertSection",
      quoteId: created.focusQuoteId,
      title: "Mobilier",
    }),
    actor,
  );
}

const style = {
  fontFamily: "GEORGIA" as const,
  fontSizePx: 22,
  textColor: "#112233",
  highlightColor: "#ffeeaa",
  bold: true,
  italic: true,
};

const photo = {
  id: "44444444-4444-4444-8444-444444444444",
  fileName: "vue.jpg",
  contentType: "image/jpeg" as const,
  sizeBytes: 1234,
  sha256: "a".repeat(64),
  storagePath: "quotes/q/items/i/photos/p/vue.jpg",
  clientVisible: false,
  uploadedAt: "2026-09-16T08:00:00.000Z",
  uploadedByName: "Lucien",
};

describe("quote client presentation", () => {
  it("stores text styling and preserves it when the heading text is edited", () => {
    const source = withSection();
    const section = source.payload.quotes[0].model.items[0];
    const styled = applyQuotesMutation(
      source.payload,
      quotesMutationSchema.parse({
        action: "updateItemPresentation",
        quoteId: source.focusQuoteId,
        itemId: section.id,
        textStyle: style,
      }),
      actor,
    );
    const edited = applyQuotesMutation(
      styled.payload,
      quotesMutationSchema.parse({
        action: "upsertSection",
        quoteId: source.focusQuoteId,
        itemId: section.id,
        title: "Mobilier sur mesure",
      }),
      actor,
    );
    expect(edited.payload.quotes[0].model.items[0]).toMatchObject({
      title: "Mobilier sur mesure",
      presentation: { textStyle: style },
    });
  });

  it("registers, exposes to client, then removes an item photo", () => {
    const source = withSection();
    const section = source.payload.quotes[0].model.items[0];
    const added = registerQuoteItemPhotos(
      source.payload,
      source.focusQuoteId,
      section.id,
      [photo],
      actor,
    );
    expect(added.payload.quotes[0].model.items[0].presentation?.photos[0].clientVisible).toBe(
      false,
    );
    const visible = setQuoteItemPhotoVisibility(
      added.payload,
      source.focusQuoteId,
      section.id,
      photo.id,
      true,
      actor,
    );
    expect(visible.payload.quotes[0].model.items[0].presentation?.photos[0].clientVisible).toBe(
      true,
    );
    const removed = removeQuoteItemPhoto(
      visible.payload,
      source.focusQuoteId,
      section.id,
      photo.id,
      actor,
    );
    expect(removed.payload.quotes[0].model.items[0].presentation?.photos ?? []).toHaveLength(0);
  });

  it("duplicates the visual style but deliberately does not duplicate photo references", () => {
    const source = withSection();
    const section = source.payload.quotes[0].model.items[0];
    const styled = applyQuotesMutation(
      source.payload,
      quotesMutationSchema.parse({
        action: "updateItemPresentation",
        quoteId: source.focusQuoteId,
        itemId: section.id,
        textStyle: style,
      }),
      actor,
    );
    const withPhoto = registerQuoteItemPhotos(
      styled.payload,
      source.focusQuoteId,
      section.id,
      [photo],
      actor,
    );
    const duplicated = applyQuotesMutation(
      withPhoto.payload,
      quotesMutationSchema.parse({
        action: "duplicateHeading",
        quoteId: source.focusQuoteId,
        itemId: section.id,
      }),
      actor,
    );
    const copy = duplicated.payload.quotes[0].model.items[1];
    expect(copy.presentation?.textStyle).toEqual(style);
    expect(copy.presentation?.photos).toEqual([]);
  });
});
