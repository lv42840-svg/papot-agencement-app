import { describe, expect, it } from "vitest";
import { parseQuoteModel } from "../src/lib/quotes/model";
import {
  applyQuoteRichTextStyle,
  quoteRichTextFromPlainText,
  quoteRichTextToPlainText,
  resolveQuoteRichText,
} from "../src/lib/quotes/rich-text";

const SECTION_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ID = "22222222-2222-4222-8222-222222222222";
const QUOTE_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";

describe("quote rich text", () => {
  it("colors only the selected word in a designation", () => {
    const source = quoteRichTextFromPlainText("Meuble vasque salle de bain");
    const styled = applyQuoteRichTextStyle(source, 7, 13, { textColor: "#2563eb" });

    expect(styled.runs).toEqual([
      {
        text: "Meuble ",
        style: expect.objectContaining({ textColor: null }),
      },
      {
        text: "vasque",
        style: expect.objectContaining({ textColor: "#2563eb" }),
      },
      {
        text: " salle de bain",
        style: expect.objectContaining({ textColor: null }),
      },
    ]);
    expect(quoteRichTextToPlainText(styled)).toBe("Meuble vasque salle de bain");
  });

  it("applies bold, italic and underline to a complete title", () => {
    const title = "Salle de bain étage";
    let styled = quoteRichTextFromPlainText(title);
    styled = applyQuoteRichTextStyle(styled, 0, title.length, { bold: true });
    styled = applyQuoteRichTextStyle(styled, 0, title.length, { italic: true, underline: true });

    expect(styled.runs).toHaveLength(1);
    expect(styled.runs[0]).toEqual({
      text: title,
      style: expect.objectContaining({ bold: true, italic: true, underline: true }),
    });
  });

  it("persists rich text on section titles and line designations in the quote model", () => {
    const title = applyQuoteRichTextStyle(quoteRichTextFromPlainText("Salle de bain"), 0, 5, {
      textColor: "#7c3aed",
    });
    const designation = applyQuoteRichTextStyle(
      quoteRichTextFromPlainText("Meuble vasque salle de bain"),
      7,
      13,
      { bold: true, textColor: "#2563eb" },
    );

    const model = parseQuoteModel({
      id: QUOTE_ID,
      clientId: CLIENT_ID,
      subject: "Test rich text",
      issueDate: "2026-09-16",
      validityDays: 30,
      paymentTerms: "45 jours fin de mois",
      items: [
        {
          id: SECTION_ID,
          kind: "SECTION",
          parentId: null,
          title: "Salle de bain",
          presentation: { richText: title, photos: [] },
        },
        {
          id: LINE_ID,
          kind: "LINE",
          parentId: SECTION_ID,
          description: "Meuble vasque salle de bain",
          unit: "u",
          quantity: 1,
          quantityFormula: null,
          unitPriceCents: 10000,
          presentation: { richText: designation, photos: [] },
        },
      ],
    });

    expect(model.items[0].presentation?.richText).toEqual(title);
    expect(model.items[1].presentation?.richText).toEqual(designation);
  });

  it("keeps old partial color marks readable as a fallback", () => {
    const resolved = resolveQuoteRichText("Meuble vasque", undefined, {
      fontFamily: "DEFAULT",
      fontSizePx: 13,
      textColor: "#111827",
      highlightColor: null,
      bold: false,
      italic: false,
      textColorMarks: [{ start: 7, end: 13, color: "#b91c1c" }],
    });

    expect(resolved.runs.map((run) => [run.text, run.style.textColor])).toEqual([
      ["Meuble ", "#111827"],
      ["vasque", "#b91c1c"],
    ]);
  });
});
