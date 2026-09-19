import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adjustmentsEditor = readFileSync(
  new URL("../src/components/quote-pricing-adjustments-editor.tsx", import.meta.url),
  "utf8",
);
const fixedSummary = readFileSync(
  new URL("../src/components/quote-fixed-summary.tsx", import.meta.url),
  "utf8",
);

describe("quote customer discount UI", () => {
  it("permet une remise client visible en pourcentage ou en euros", () => {
    expect(adjustmentsEditor).toContain("Remise client");
    expect(adjustmentsEditor).toContain('value="PERCENTAGE"');
    expect(adjustmentsEditor).toContain('value="AMOUNT"');
    expect(adjustmentsEditor).toContain('action: "setCustomerDiscount"');
    expect(adjustmentsEditor).toContain('action: "clearCustomerDiscount"');
  });

  it("affiche la remise dans la synthèse économique du devis", () => {
    expect(fixedSummary).toContain("customerDiscountCents");
    expect(fixedSummary).toContain("discountMetric");
    expect(fixedSummary).toContain("Remise client");
  });
});
