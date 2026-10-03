import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const linesSource = readFileSync(
  new URL("../src/components/quote-structured-lines-editor.tsx", import.meta.url),
  "utf-8",
);
const adjustmentsSource = readFileSync(
  new URL("../src/components/quote-pricing-adjustments-editor.tsx", import.meta.url),
  "utf-8",
);

describe("inline quote options", () => {
  it("puts the O toggle directly in quote row actions", () => {
    expect(linesSource).toContain("toggleItemOption");
    expect(linesSource).toContain("miniOptionButton");
    expect(linesSource).toContain("Mettre en option hors total");
  });

  it("removes the old large options module", () => {
    expect(adjustmentsSource).not.toContain("Options client hors total");
    expect(adjustmentsSource).not.toContain("Choisir une ligne ou un groupe");
    expect(adjustmentsSource).not.toContain("Mettre en option</button>");
  });
});
