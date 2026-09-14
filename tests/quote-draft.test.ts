import { describe, expect, it } from "vitest";
import {
  appendFreeQuoteLine,
  appendQuoteComment,
  appendQuoteSection,
  appendQuoteSubsection,
  createQuoteDraft,
  eurosInputToQuoteCents,
  quoteTotalHtCents,
  removeQuoteItemTree,
  replaceQuoteItem,
  updateQuoteLineQuantityInput,
} from "../src/lib/quotes/draft";

const quoteId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sectionId = "11111111-1111-4111-8111-111111111111";
const subsectionId = "22222222-2222-4222-8222-222222222222";
const lineId = "33333333-3333-4333-8333-333333333333";
const commentId = "44444444-4444-4444-8444-444444444444";

function draft() {
  return createQuoteDraft({
    id: quoteId,
    clientId,
    issueDate: "2026-09-14",
    paymentTerms: "45 jours fin de mois",
  });
}

describe("desktop quote draft helpers", () => {
  it("creates a valid 30-day draft", () => {
    expect(draft()).toMatchObject({
      id: quoteId,
      clientId,
      subject: "Nouveau devis",
      issueDate: "2026-09-14",
      validityDays: 30,
      paymentTerms: "45 jours fin de mois",
      items: [],
    });
  });

  it("builds section, subsection, line and comment hierarchy", () => {
    let quote = appendQuoteSection(draft(), { id: sectionId, title: "Mobilier" });
    quote = appendQuoteSubsection(quote, {
      id: subsectionId,
      parentId: sectionId,
      title: "Meubles bas",
    });
    quote = appendFreeQuoteLine(quote, {
      id: lineId,
      parentId: subsectionId,
      description: "Caisson",
      unitPriceCents: 10_000,
    });
    quote = appendQuoteComment(quote, {
      id: commentId,
      parentId: sectionId,
      text: "Coloris à confirmer",
    });

    expect(quote.items).toHaveLength(4);
    expect(quote.items[2]).toMatchObject({
      kind: "LINE",
      parentId: subsectionId,
      description: "Caisson",
    });
  });

  it("keeps the quantity formula entered on screen", () => {
    let quote = appendFreeQuoteLine(draft(), { id: lineId, quantityInput: "1" });
    quote = updateQuoteLineQuantityInput(quote, lineId, "2+6+4+9");

    expect(quote.items[0]).toMatchObject({
      kind: "LINE",
      quantity: 21,
      quantityFormula: "2+6+4+9",
    });
  });

  it("calculates the provisional HT total from quote-owned prices", () => {
    let quote = appendFreeQuoteLine(draft(), {
      id: lineId,
      quantityInput: "2.5",
      unitPriceCents: 10_000,
    });
    quote = appendFreeQuoteLine(quote, {
      id: "55555555-5555-4555-8555-555555555555",
      quantityInput: "3",
      unitPriceCents: 2_000,
    });

    expect(quoteTotalHtCents(quote)).toBe(31_000);
  });

  it("removes a section and its complete child tree", () => {
    let quote = appendQuoteSection(draft(), { id: sectionId });
    quote = appendQuoteSubsection(quote, { id: subsectionId, parentId: sectionId });
    quote = appendFreeQuoteLine(quote, { id: lineId, parentId: subsectionId });
    quote = appendQuoteComment(quote, { id: commentId, parentId: sectionId });
    quote = appendFreeQuoteLine(quote, {
      id: "55555555-5555-4555-8555-555555555555",
      description: "Ligne racine",
    });

    const result = removeQuoteItemTree(quote, sectionId);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ description: "Ligne racine" });
  });

  it("replaces an editable quote item while preserving validation", () => {
    let quote = appendQuoteSection(draft(), { id: sectionId, title: "Mobilier" });
    quote = replaceQuoteItem(quote, {
      id: sectionId,
      kind: "SECTION",
      parentId: null,
      title: "Agencement mural",
    });

    expect(quote.items[0]).toMatchObject({ title: "Agencement mural" });
  });

  it("accepts French decimal money input", () => {
    expect(eurosInputToQuoteCents("123,45")).toBe(12_345);
    expect(eurosInputToQuoteCents("0")).toBe(0);
  });

  it("rejects malformed screen values", () => {
    expect(() => eurosInputToQuoteCents("-1")).toThrow("QUOTE_MONEY_INVALID");
    expect(() => updateQuoteLineQuantityInput(appendFreeQuoteLine(draft(), { id: lineId }), lineId, "2/0")).toThrow(
      "QUOTE_QUANTITY_DIVISION_BY_ZERO",
    );
    expect(() => removeQuoteItemTree(draft(), lineId)).toThrow("QUOTE_ITEM_NOT_FOUND");
  });
});
