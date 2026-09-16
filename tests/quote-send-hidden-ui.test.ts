import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const directEditor = readFileSync(
  new URL("../src/components/quote-direct-editor.tsx", import.meta.url),
  "utf-8",
);

describe("quote send action visibility", () => {
  it("n'expose pas l'action d'envoi dans l'interface active du devis", () => {
    expect(directEditor).not.toContain("QuoteSendAction");
    expect(directEditor).toContain("QuoteComponentCheck");
    expect(directEditor).toContain("QuoteLifecycleActions");
  });
});
