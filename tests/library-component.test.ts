import { describe, expect, it } from "vitest";
import {
  calculateLibraryComponentMarginPercent,
  calculateLibraryComponentSalePriceCents,
  parseLibraryComponent,
} from "../src/lib/library/component";

function minimalComponent() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Panneau mélaminé blanc",
    description: "Panneau décor blanc pour fabrication de mobilier.",
    unit: "m²",
    costPriceCents: 4_250,
    marginPercent: 30,
    salePriceCents: 5_525,
  };
}

describe("library component model", () => {
  it("accepts a reusable material component priced entirely HT", () => {
    expect(parseLibraryComponent(minimalComponent())).toEqual(minimalComponent());
  });

  it("also accepts a labour or service component", () => {
    const component = {
      ...minimalComponent(),
      name: "Heure atelier",
      description: "",
      unit: "h",
      costPriceCents: 6_500,
      marginPercent: 40,
      salePriceCents: 9_100,
    };

    expect(parseLibraryComponent(component)).toEqual(component);
  });

  it("calculates the HT sale price when margin percent is entered", () => {
    expect(calculateLibraryComponentSalePriceCents(10_000, 30)).toBe(13_000);
  });

  it("calculates margin percent when the HT sale price is entered", () => {
    expect(calculateLibraryComponentMarginPercent(10_000, 13_000)).toBe(30);
  });

  it("rounds a calculated HT sale price to the nearest cent", () => {
    expect(calculateLibraryComponentSalePriceCents(199, 30)).toBe(259);
  });

  it("rejects a stored margin and sale price that do not match", () => {
    expect(() =>
      parseLibraryComponent({
        ...minimalComponent(),
        salePriceCents: 5_524,
      }),
    ).toThrow("LIBRARY_COMPONENT_PRICING_MISMATCH");
  });

  it("normalizes surrounding whitespace in text fields", () => {
    const component = parseLibraryComponent({
      ...minimalComponent(),
      name: "  Charnière invisible  ",
      description: "  Ouverture 110°  ",
      unit: "  u  ",
    });

    expect(component).toMatchObject({
      name: "Charnière invisible",
      description: "Ouverture 110°",
      unit: "u",
    });
  });

  it("allows a fully zero-priced component", () => {
    expect(
      parseLibraryComponent({
        ...minimalComponent(),
        costPriceCents: 0,
        marginPercent: 0,
        salePriceCents: 0,
      }),
    ).toMatchObject({ costPriceCents: 0, marginPercent: 0, salePriceCents: 0 });
    expect(calculateLibraryComponentMarginPercent(0, 0)).toBe(0);
  });

  it("rejects a positive sale price when cost is zero because margin is undefined", () => {
    expect(() => calculateLibraryComponentMarginPercent(0, 100)).toThrow(
      "LIBRARY_COMPONENT_MARGIN_UNDEFINED",
    );
  });

  it("does not keep VAT in the component model", () => {
    expect(
      parseLibraryComponent({
        ...minimalComponent(),
        vatRatePercent: 20,
      }),
    ).not.toHaveProperty("vatRatePercent");
  });

  it("requires a valid identity, name and unit", () => {
    expect(() => parseLibraryComponent({ ...minimalComponent(), id: "not-a-uuid" })).toThrow(
      "LIBRARY_COMPONENT_INVALID",
    );
    expect(() => parseLibraryComponent({ ...minimalComponent(), name: "   " })).toThrow(
      "LIBRARY_COMPONENT_INVALID",
    );
    expect(() => parseLibraryComponent({ ...minimalComponent(), unit: "" })).toThrow(
      "LIBRARY_COMPONENT_INVALID",
    );
  });

  it("rejects invalid HT cost, margin and sale values", () => {
    expect(() => parseLibraryComponent({ ...minimalComponent(), costPriceCents: -1 })).toThrow(
      "LIBRARY_COMPONENT_INVALID",
    );
    expect(() => parseLibraryComponent({ ...minimalComponent(), costPriceCents: 12.5 })).toThrow(
      "LIBRARY_COMPONENT_INVALID",
    );
    expect(() => parseLibraryComponent({ ...minimalComponent(), marginPercent: -1 })).toThrow(
      "LIBRARY_COMPONENT_INVALID",
    );
    expect(() => parseLibraryComponent({ ...minimalComponent(), marginPercent: Infinity })).toThrow(
      "LIBRARY_COMPONENT_INVALID",
    );
    expect(() => parseLibraryComponent({ ...minimalComponent(), salePriceCents: -1 })).toThrow(
      "LIBRARY_COMPONENT_INVALID",
    );
    expect(() => parseLibraryComponent({ ...minimalComponent(), salePriceCents: 12.5 })).toThrow(
      "LIBRARY_COMPONENT_INVALID",
    );
  });

  it("does not allow a negative margin through an entered sale price", () => {
    expect(() => calculateLibraryComponentMarginPercent(10_000, 9_999)).toThrow(
      "LIBRARY_COMPONENT_PRICING_INVALID",
    );
  });
});
