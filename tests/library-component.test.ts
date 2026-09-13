import { describe, expect, it } from "vitest";
import { parseLibraryComponent } from "../src/lib/library/component";

function minimalComponent() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Panneau mélaminé blanc",
    description: "Panneau décor blanc pour fabrication de mobilier.",
    unit: "m²",
    unitPriceCents: 4_250,
    vatRatePercent: 20,
  };
}

describe("library component model", () => {
  it("accepts a reusable material component", () => {
    expect(parseLibraryComponent(minimalComponent())).toEqual(minimalComponent());
  });

  it("also accepts a labour or service component", () => {
    const component = {
      ...minimalComponent(),
      name: "Heure atelier",
      description: "",
      unit: "h",
      unitPriceCents: 6_500,
    };

    expect(parseLibraryComponent(component)).toEqual(component);
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

  it("allows a zero sale price or zero VAT rate", () => {
    expect(
      parseLibraryComponent({
        ...minimalComponent(),
        unitPriceCents: 0,
        vatRatePercent: 0,
      }),
    ).toMatchObject({ unitPriceCents: 0, vatRatePercent: 0 });
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

  it("rejects invalid financial values", () => {
    expect(() => parseLibraryComponent({ ...minimalComponent(), unitPriceCents: -1 })).toThrow(
      "LIBRARY_COMPONENT_INVALID",
    );
    expect(() => parseLibraryComponent({ ...minimalComponent(), unitPriceCents: 12.5 })).toThrow(
      "LIBRARY_COMPONENT_INVALID",
    );
    expect(() => parseLibraryComponent({ ...minimalComponent(), vatRatePercent: -1 })).toThrow(
      "LIBRARY_COMPONENT_INVALID",
    );
    expect(() => parseLibraryComponent({ ...minimalComponent(), vatRatePercent: 101 })).toThrow(
      "LIBRARY_COMPONENT_INVALID",
    );
  });
});
