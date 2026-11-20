import { describe, expect, it } from "vitest";
import { previewNativeCreditNote } from "../src/lib/billing/native-credit-preview";

const allowances = [
  { ratePercent: 10, remainingHtCents: 20_000, remainingVatCents: 2_000 },
  { ratePercent: 20, remainingHtCents: 50_000, remainingVatCents: 10_000 },
];

describe("simulation d'avoir avant émission", () => {
  it("présente le total HT, la TVA et le TTC par taux en émission totale", () => {
    expect(previewNativeCreditNote(allowances, "FULL", {})).toEqual({
      valid: true,
      amounts: [
        { ratePercent: 10, baseHtCents: 20_000 },
        { ratePercent: 20, baseHtCents: 50_000 },
      ],
      htCents: 70_000,
      vatCents: 12_000,
      totalTtcCents: 82_000,
      error: null,
    });
  });

  it("accepte une correction partielle de plusieurs taux avec arrondis", () => {
    expect(previewNativeCreditNote(allowances, "PARTIAL", {
      "10": "49,99",
      "20": "30.01",
    })).toMatchObject({
      valid: true,
      amounts: [
        { ratePercent: 10, baseHtCents: 4999 },
        { ratePercent: 20, baseHtCents: 3001 },
      ],
      htCents: 8000,
      vatCents: 1100,
      totalTtcCents: 9100,
    });
  });

  it("refuse une saisie invalide au lieu de l'ignorer", () => {
    for (const invalidInput of ["toto", "-5", "5,123", "300", "100000000000000000000", "2.4.1"]) {
      const result = previewNativeCreditNote(allowances, "PARTIAL", {
        "10": "3,00",
        "20": invalidInput,
      });
      expect(result.valid, invalidInput).toBe(false);
      expect(result.amounts).toEqual([]);
    }
  });

  it("refuse zéro et absence de montants sans attribuer un numéro", () => {
    expect(previewNativeCreditNote(allowances, "PARTIAL", {}).valid).toBe(false);
    expect(previewNativeCreditNote(allowances, "PARTIAL", { "10": "0", "20": "0" }).valid).toBe(false);
  });

  it("utilise le restant exact de TVA si le HT est soldé, y compris les arrondis", () => {
    const rounded = [
      { ratePercent: 5.5, remainingHtCents: 100, remainingVatCents: 5 },
    ];
    expect(previewNativeCreditNote(rounded, "FULL", {}).totalTtcCents).toBe(105);
    expect(previewNativeCreditNote(rounded, "PARTIAL", { "5.5": "1,00" }).vatCents).toBe(5);
  });

  it("bloque une ventilation TVA incohérente et les doubles taux", () => {
    expect(previewNativeCreditNote([...allowances, allowances[0]], "FULL", {}).valid).toBe(false);
    expect(previewNativeCreditNote([{ ratePercent: 20, remainingHtCents: 0, remainingVatCents: 1 }], "FULL", {}).valid).toBe(false);
    expect(previewNativeCreditNote([{ ratePercent: 20, remainingHtCents: 1, remainingVatCents: 0 }], "PARTIAL", { "20": "0,01" }).valid).toBe(true);
  });
});
