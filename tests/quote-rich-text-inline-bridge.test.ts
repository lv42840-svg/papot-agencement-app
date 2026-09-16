import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bridge = readFileSync(
  new URL("../src/components/quote-structured-lines-rich-editor.tsx", import.meta.url),
  "utf8",
);

describe("quote rich text inline bridge", () => {
  it("supports existing and newly created quote items", () => {
    expect(bridge).toContain('const key = `${kind}:${itemId ?? "new"}:${number}`');
    expect(bridge).toContain("beforeItemIds");
    expect(bridge).toContain("!pending.beforeItemIds.has(item.id)");
    expect(bridge).toContain("itemText(item) === plainText");
  });

  it("keeps the business form synchronized with the rich editor", () => {
    expect(bridge).toContain(
      "Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, \"value\")",
    );
    expect(bridge).toContain('new Event("input", { bubbles: true })');
    expect(bridge).toContain("quoteRichTextToPlainText(next)");
  });

  it("persists the rich runs after the structured form save", () => {
    expect(bridge).toContain("pendingSaveRef");
    expect(bridge).toContain("trimmedRichText");
    expect(bridge).toContain("/items/${target.id}/rich-text");
    expect(bridge).toContain("onSaved(data.payload)");
  });
});
