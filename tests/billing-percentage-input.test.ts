import { describe, expect, it } from "vitest";
import { parseBillingPercentageInput } from "../src/lib/billing/percentage-input";

describe("saisie du pourcentage de facturation", () => {
  it("n'envoie pas le texte grisé de l'exemple comme valeur", () => {
    expect(parseBillingPercentageInput("")).toBeNull();
    expect(parseBillingPercentageInput("   ")).toBeNull();
    expect(parseBillingPercentageInput("0")).toBeNull();
  });

  it("accepte 30 pour un acompte de 30 % et la virgule française", () => {
    expect(parseBillingPercentageInput("30")).toBe(30);
    expect(parseBillingPercentageInput(" 30 ")).toBe(30);
    expect(parseBillingPercentageInput("12,5")).toBe(12.5);
    expect(parseBillingPercentageInput("0,01")).toBe(0.01);
    expect(parseBillingPercentageInput("100")).toBe(100);
  });

  it("refuse les dépassements et formats ambigus", () => {
    for (const input of ["101", "-5", "abc", "30 %", "1e2", "30,123", "NaN"]) {
      expect(parseBillingPercentageInput(input)).toBeNull();
    }
  });
});
