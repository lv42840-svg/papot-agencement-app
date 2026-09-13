import { describe, expect, it } from "vitest";
import { parseQuoteModel } from "../src/lib/quotes/model";

const sectionId = "11111111-1111-4111-8111-111111111111";
const subsectionId = "22222222-2222-4222-8222-222222222222";
const lineId = "33333333-3333-4333-8333-333333333333";
const commentId = "44444444-4444-4444-8444-444444444444";

type TestQuote = {
  id: string;
  clientId: string;
  subject: string;
  issueDate: string;
  validityDays: number;
  paymentTerms: string;
  items: Array<Record<string, unknown>>;
};

function minimalQuote(): TestQuote {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    subject: "Agencement accueil",
    issueDate: "2026-09-13",
    validityDays: 30,
    paymentTerms: "45 jours fin de mois",
    items: [
      {
        id: sectionId,
        kind: "SECTION",
        parentId: null,
        title: "Mobilier",
      },
      {
        id: subsectionId,
        kind: "SUBSECTION",
        parentId: sectionId,
        title: "Meubles bas",
      },
      {
        id: lineId,
        kind: "LINE",
        parentId: subsectionId,
        description: "Caisson mélaminé",
        unit: "u",
        quantity: 21,
        quantityFormula: "2+6+4+9",
      },
      {
        id: commentId,
        kind: "COMMENT",
        parentId: sectionId,
        text: "Coloris à confirmer avec le client.",
      },
    ],
  };
}

describe("minimal native quote model", () => {
  it("accepts the minimal quote structure with sections, subsections, lines and comments", () => {
    expect(parseQuoteModel(minimalQuote())).toEqual(minimalQuote());
  });

  it(
    "keeps client reference, subject, date, validity and payment terms as quote-owned fields",
    () => {
      const quote = parseQuoteModel(minimalQuote());

      expect(quote.clientId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      expect(quote.subject).toBe("Agencement accueil");
      expect(quote.issueDate).toBe("2026-09-13");
      expect(quote.validityDays).toBe(30);
      expect(quote.paymentTerms).toBe("45 jours fin de mois");
    },
  );

  it("allows a free line or comment outside sections", () => {
    const quote = minimalQuote();
    quote.items = [
      { ...quote.items[2], parentId: null },
      { ...quote.items[3], parentId: null },
    ];

    expect(parseQuoteModel(quote).items).toHaveLength(2);
  });

  it("rejects a subsection without a section parent", () => {
    const quote = minimalQuote();
    quote.items[1] = { ...quote.items[1], parentId: lineId };

    expect(() => parseQuoteModel(quote)).toThrow("QUOTE_ITEM_PARENT_INVALID");
  });

  it("rejects missing parents and duplicate item ids", () => {
    const missingParent = minimalQuote();
    missingParent.items[2] = {
      ...missingParent.items[2],
      parentId: "99999999-9999-4999-8999-999999999999",
    };
    expect(() => parseQuoteModel(missingParent)).toThrow(
      "QUOTE_ITEM_PARENT_NOT_FOUND",
    );

    const duplicate = minimalQuote();
    duplicate.items.push({ ...duplicate.items[2] });
    expect(() => parseQuoteModel(duplicate)).toThrow("QUOTE_ITEM_ID_DUPLICATE");
  });

  it("rejects an invalid calendar date", () => {
    expect(() =>
      parseQuoteModel({ ...minimalQuote(), issueDate: "2026-02-31" }),
    ).toThrow("QUOTE_MODEL_INVALID");
  });

  it("requires payment terms and a positive validity duration", () => {
    expect(() => parseQuoteModel({ ...minimalQuote(), paymentTerms: "" })).toThrow(
      "QUOTE_MODEL_INVALID",
    );
    expect(() => parseQuoteModel({ ...minimalQuote(), validityDays: 0 })).toThrow(
      "QUOTE_MODEL_INVALID",
    );
  });

  it("keeps a quantity formula only when it explains the stored quantity", () => {
    expect(parseQuoteModel(minimalQuote()).items[2]).toMatchObject({
      quantity: 21,
      quantityFormula: "2+6+4+9",
    });

    const mismatch = minimalQuote();
    mismatch.items[2] = { ...mismatch.items[2], quantity: 20 };
    expect(() => parseQuoteModel(mismatch)).toThrow("QUOTE_LINE_FORMULA_MISMATCH");
  });

  it("rejects a plain number used as a fake formula memo", () => {
    const quote = minimalQuote();
    quote.items[2] = {
      ...quote.items[2],
      quantity: 21,
      quantityFormula: "21",
    };
    expect(() => parseQuoteModel(quote)).toThrow("QUOTE_LINE_FORMULA_INVALID");
  });
});
