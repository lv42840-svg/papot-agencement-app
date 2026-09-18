import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directEditor = readFileSync(
  new URL("../src/components/quote-direct-editor.tsx", import.meta.url),
  "utf-8",
);

describe("quote final PDF action visibility", () => {
  it("expose l'action de génération et gel dans l'interface active du devis", () => {
    expect(directEditor).toContain("QuoteSendAction");
    expect(directEditor).toContain("QuoteComponentCheck");
    expect(directEditor).toContain("QuoteLifecycleActions");
  });
});
