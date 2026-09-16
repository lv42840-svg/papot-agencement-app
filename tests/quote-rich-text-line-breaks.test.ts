import { describe, expect, it } from "vitest";
import {
  normalizeQuoteRichText,
  quoteRichTextFromPlainText,
  quoteRichTextToPlainText,
} from "../src/lib/quotes/rich-text";

describe("quote rich text line breaks", () => {
  it("preserves explicit line breaks in plain and normalized rich text", () => {
    const text = "Meuble vasque\nPlan stratifié\nPose comprise";
    const richText = quoteRichTextFromPlainText(text);

    expect(quoteRichTextToPlainText(richText)).toBe(text);
    expect(quoteRichTextToPlainText(normalizeQuoteRichText(richText))).toBe(text);
  });
});