import { describe, expect, it } from "vitest";
import { canMoveQuoteComponent, moveQuoteComponent } from "../src/lib/quotes/component-order";

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
});
