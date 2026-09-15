import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/components/quote-structured-lines-editor.tsx", import.meta.url),
  "utf-8",
);

describe("quote table layout", () => {
  it("keeps inline quote editing styled as a table", () => {
    expect(source).toContain("<style jsx global>");
    expect(source).toContain(
      "grid-template-columns: 52px minmax(300px, 1fr) 82px 72px 120px 120px 120px 82px;",
    );
    expect(source).toContain("<span>Total HT</span>");
    expect(source).toContain("quoteLineTotal");
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
