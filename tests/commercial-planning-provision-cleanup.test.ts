import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/app/api/desktop/commercial/route.ts", import.meta.url),
  "utf-8",
);

describe("commercial planning provision cleanup bridge", () => {
  it("clears weekly provisional allocations when an affair is closed", () => {
    expect(source).toContain('input.action === "close"');
    expect(source).toContain('input.nextStatus === "LOST"');
    expect(source).toContain('input.nextStatus === "ABANDONED"');
    expect(source).toContain("clearPlanningProvisionForCommercialCase");
  });

  it("clears again on reopen so an old distribution can never be restored", () => {
    expect(source).toContain('input.action === "reopen"');
    expect(source).toContain('stage = "clear-planning-provision"');
  });
});
