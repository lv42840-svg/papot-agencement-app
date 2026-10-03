import { describe, expect, it } from "vitest";
import { removeLibraryComponent } from "../src/lib/library/catalog-edit";
import {
  ensureRequiredLaborComponents,
  REQUIRED_LABOR_COMPONENT_IDS,
} from "../src/lib/library/required-labor-components";
import { createInitialLibraryPayload } from "../src/lib/library/storage";

describe("required labor Library components", () => {
  it("adds BE, Atelier and Pose with hour units and no invented tariff", () => {
    const payload = ensureRequiredLaborComponents(createInitialLibraryPayload());
    expect(payload.components).toHaveLength(3);
    expect(
      payload.components.map((component) => ({
        name: component.name,
        activity: component.activity,
        unit: component.unit,
        cost: component.costPriceCents,
        sale: component.salePriceCents,
      })),
    ).toEqual([
      { name: "Heure BE", activity: "BE", unit: "h", cost: 0, sale: 0 },
      { name: "Heure atelier", activity: "ATELIER", unit: "h", cost: 0, sale: 0 },
      { name: "Heure pose", activity: "POSE", unit: "h", cost: 0, sale: 0 },
    ]);
  });

  it("is idempotent and preserves edited pricing for an existing activity", () => {
    const first = ensureRequiredLaborComponents(createInitialLibraryPayload());
    first.components[0] = {
      ...first.components[0],
      costPriceCents: 5_000,
      marginPercent: 40,
      salePriceCents: 7_000,
    };
    const second = ensureRequiredLaborComponents(first);
    expect(second.components).toHaveLength(3);
    expect(second.components.find((component) => component.activity === "BE")).toMatchObject({
      costPriceCents: 5_000,
      salePriceCents: 7_000,
    });
  });

  it("prevents deleting the three required semantic components", () => {
    const payload = ensureRequiredLaborComponents(createInitialLibraryPayload());
    expect(() => removeLibraryComponent(payload, REQUIRED_LABOR_COMPONENT_IDS.BE)).toThrow(
      "LIBRARY_COMPONENT_REQUIRED",
    );
  });
});
