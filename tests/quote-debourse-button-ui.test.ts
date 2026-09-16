import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const checkSource = readFileSync(
  new URL("../src/components/quote-component-check.tsx", import.meta.url),
  "utf-8",
);
const editorSource = readFileSync(
  new URL("../src/components/quote-direct-editor.tsx", import.meta.url),
  "utf-8",
);

describe("quote debourse button", () => {
  it("labels the component control as Debourse", () => {
    expect(checkSource).toContain("Déboursé");
    expect(checkSource).not.toContain("Σ Composants");
  });

  it("places Debourse immediately before Send in the quote header", () => {
    const debourseIndex = editorSource.indexOf("<QuoteComponentCheck quote={quote} />");
    const sendIndex = editorSource.indexOf("<QuoteSendAction quote={quote}");
    const backIndex = editorSource.indexOf("Tous les devis");

    expect(backIndex).toBeGreaterThanOrEqual(0);
    expect(debourseIndex).toBeGreaterThan(backIndex);
    expect(sendIndex).toBeGreaterThan(debourseIndex);
  });
});
