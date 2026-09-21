import { describe, expect, it } from "vitest";
import {
  canMoveQuoteComponent,
  duplicateQuoteComponent,
  moveQuoteComponent,
} from "../src/lib/quotes/component-order";

describe("quote component order", () => {
  it("moves a component up without mutating the source array", () => {
    const source = ["Panneau", "Quincaillerie", "Pose"];
    const moved = moveQuoteComponent(source, 2, "UP");

    expect(moved).toEqual(["Panneau", "Pose", "Quincaillerie"]);
    expect(source).toEqual(["Panneau", "Quincaillerie", "Pose"]);
  });

  it("moves a component down", () => {
    expect(moveQuoteComponent(["BE", "Fabrication", "Pose"], 0, "DOWN")).toEqual([
      "Fabrication",
      "BE",
      "Pose",
    ]);
  });

  it("blocks movement outside the component list", () => {
    expect(canMoveQuoteComponent(3, 0, "UP")).toBe(false);
    expect(canMoveQuoteComponent(3, 2, "DOWN")).toBe(false);
    expect(canMoveQuoteComponent(3, 1, "UP")).toBe(true);
    expect(canMoveQuoteComponent(3, 1, "DOWN")).toBe(true);
    expect(moveQuoteComponent(["A", "B", "C"], 0, "UP")).toEqual(["A", "B", "C"]);
  });

  it("duplicates a component immediately after the source with a fresh identity", () => {
    const source = [
      {
        key: "component-a",
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        libraryComponentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        description: "Panneau mélaminé",
        unit: "m²",
        quantityInput: "2,5",
        costPriceEuros: "22,50",
        marginPercentInput: "35",
        unitPriceEuros: "30,38",
        pricingDriver: "MARGIN" as const,
      },
      {
        key: "component-b",
        description: "Pose",
      },
    ];

    const duplicated = duplicateQuoteComponent(source, 0, () => "component-copy");

    expect(duplicated).toHaveLength(3);
    expect(duplicated[1]).toEqual({
      ...source[0],
      key: "component-copy",
      id: undefined,
    });
    expect(duplicated[1]).not.toBe(source[0]);
    expect(duplicated[2]).toBe(source[1]);
    expect(source).toHaveLength(2);
    expect(source[0].id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("ignores an invalid duplication index without mutating the source", () => {
    const source = [{ key: "a", description: "A" }];
    const duplicated = duplicateQuoteComponent(source, 4, () => "unused");

    expect(duplicated).toEqual(source);
    expect(duplicated).not.toBe(source);
  });
});
