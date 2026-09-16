import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/components/quote-structured-lines-editor.tsx", import.meta.url),
  "utf-8",
);

describe("quote table layout", () => {
  it("keeps inline quote editing styled as a table without hiding Total HT", () => {
    expect(source).toContain("<style jsx global>");
    expect(source).toContain(
      "grid-template-columns: 44px minmax(250px, 1fr) 64px 56px 104px 100px 110px 228px;",
    );
    expect(source).toContain("<span>Total HT</span>");
    expect(source).toContain("quoteLineTotal");
    expect(source).toContain(".miniOptionButton");
  });

  it("uses drag-and-drop instead of arrow movement controls", () => {
    expect(source).not.toContain("ArrowUp");
    expect(source).not.toContain("ArrowDown");
    expect(source).not.toContain("Remonter l’ouvrage");
    expect(source).not.toContain("Descendre l’ouvrage");
    expect(source).toContain("Glisser-déposer pour déplacer le composant");
  });

  it("uses the requested hierarchy font sizes", () => {
    expect(source).toContain(".quoteHeadingRow.isSection > strong");
    expect(source).toContain("font-size: 18px;");
    expect(source).toContain(".quoteHeadingRow.isSubsection > strong");
    expect(source).toContain("font-size: 15px;");
    expect(source).toContain(".quoteComponentRow");
    expect(source).toContain("font-size: 13px;");
  });
});
