import { describe, expect, it } from "vitest";
import {
  applyQuoteInlineTextColor,
  buildQuoteInlineTextSegments,
} from "../src/lib/quotes/inline-text-color";

describe("quote inline text color", () => {
  it("colors only the selected characters", () => {
    expect(applyQuoteInlineTextColor(20, [], 4, 10, "#2563eb")).toEqual([
      { start: 4, end: 10, color: "#2563eb" },
    ]);
  });

  it("recolors an overlapping selection without keeping overlapping marks", () => {
    expect(
      applyQuoteInlineTextColor(20, [{ start: 2, end: 12, color: "#2563eb" }], 6, 9, "#b91c1c"),
    ).toEqual([
      { start: 2, end: 6, color: "#2563eb" },
      { start: 6, end: 9, color: "#b91c1c" },
      { start: 9, end: 12, color: "#2563eb" },
    ]);
  });

  it("removes color only from the selected characters", () => {
    expect(
      applyQuoteInlineTextColor(20, [{ start: 2, end: 12, color: "#2563eb" }], 5, 8, null),
    ).toEqual([
      { start: 2, end: 5, color: "#2563eb" },
      { start: 8, end: 12, color: "#2563eb" },
    ]);
  });

  it("supports selecting the complete text", () => {
    expect(applyQuoteInlineTextColor(8, [], 0, 8, "#15803d")).toEqual([
      { start: 0, end: 8, color: "#15803d" },
    ]);
  });

  it("builds colored and uncolored display segments", () => {
    expect(
      buildQuoteInlineTextSegments("meuble vasque", [{ start: 0, end: 6, color: "#6554b5" }]),
    ).toEqual([
      { start: 0, end: 6, text: "meuble", color: "#6554b5" },
      { start: 6, end: 13, text: " vasque", color: null },
    ]);
  });
});
