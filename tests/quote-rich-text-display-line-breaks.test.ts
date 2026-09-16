import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string) {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

describe("quote rich text saved display", () => {
  it("overrides the legacy single-line clipping for saved multiline text", () => {
    const layer = source("src/components/quote-rich-text-layer.tsx");

    expect(layer).toContain('whiteSpace: "pre-wrap"');
    expect(layer).toContain('overflowWrap: "anywhere"');
    expect(layer).toContain('overflow: "visible"');
    expect(layer).toContain('textOverflow: "clip"');
    expect(layer).toContain('".quoteHeadingRow > strong, .quoteLineDescription > strong"');
  });
});
