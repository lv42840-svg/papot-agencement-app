import { describe, expect, it } from "vitest";
import { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";
import { createInitialNativeQuotesPayload } from "../src/lib/quotes/store";
import { buildQuoteItemNumbers } from "../src/lib/quotes/numbering";

const actor = { userId: "11111111-1111-4111-8111-111111111111", displayName: "Lucien" };
function draft() {
  return applyQuotesMutation(
    createInitialNativeQuotesPayload(),
    quotesMutationSchema.parse({
      action: "createDraft",
      commercialCaseId: "22222222-2222-4222-8222-222222222222",
      subject: "Banque d'accueil",
      issueDate: "2026-11-17",
      paymentTerms: "30 jours",
    }),
    actor,
    "33333333-3333-4333-8333-333333333333",
  );
}
const change = (payload: ReturnType<typeof draft>["payload"], command: object) =>
  applyQuotesMutation(payload, quotesMutationSchema.parse(command), actor);

describe("texte libre parmi les lignes des devis", () => {
  it("ajoute, modifie, déplace puis supprime sans exiger de quantité ou de prix", () => {
    const created = draft();
    const first = change(created.payload, {
      action: "upsertComment",
      quoteId: created.focusQuoteId,
      text: "Sous réserve de validation",
    });
    const second = change(first.payload, {
      action: "upsertComment",
      quoteId: created.focusQuoteId,
      text: "Visite sur site obligatoire",
    });
    const a = second.payload.quotes[0].model.items[0];
    const b = second.payload.quotes[0].model.items[1];
    expect(a.kind).toBe("COMMENT");
    const edited = change(second.payload, {
      action: "upsertComment",
      quoteId: created.focusQuoteId,
      itemId: a.id,
      text: "Texte modifié",
    });
    expect(edited.payload.quotes[0].model.items[0]).toMatchObject({
      id: a.id,
      text: "Texte modifié",
    });
    const moved = change(edited.payload, {
      action: "reorderItem",
      quoteId: created.focusQuoteId,
      itemId: a.id,
      targetId: b.id,
      placement: "AFTER",
    });
    expect(moved.payload.quotes[0].model.items.map((item) => item.id)).toEqual([b.id, a.id]);
    expect(buildQuoteItemNumbers(moved.payload.quotes[0].model.items).size).toBe(2);
    const removed = change(moved.payload, {
      action: "deleteItem",
      quoteId: created.focusQuoteId,
      itemId: b.id,
    });
    expect(removed.payload.quotes[0].model.items.map((item) => item.id)).toEqual([a.id]);
  });
  it("rejette le texte vide et les références de parents inconnues", () => {
    const created = draft();
    expect(() =>
      quotesMutationSchema.parse({
        action: "upsertComment",
        quoteId: created.focusQuoteId,
        text: " ",
      }),
    ).toThrow();
    expect(() =>
      change(created.payload, {
        action: "upsertComment",
        quoteId: created.focusQuoteId,
        parentId: "44444444-4444-4444-8444-444444444444",
        text: "Test",
      }),
    ).toThrow("QUOTE_ITEM_PARENT_INVALID");
  });
});
