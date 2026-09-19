import { describe, expect, it } from "vitest";
import { commercialAffairHref } from "../src/lib/commercial/navigation";

describe("commercial affair navigation", () => {
  it("opens an affair on its dedicated route", () => {
    expect(commercialAffairHref("case-123")).toBe("/commercial/case-123");
  });

  it("encodes route-unsafe ids and falls back to the commercial list", () => {
    expect(commercialAffairHref(" affair / 42 ")).toBe("/commercial/affair%20%2F%2042");
    expect(commercialAffairHref("   ")).toBe("/commercial");
  });
});
