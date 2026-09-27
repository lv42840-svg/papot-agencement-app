import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/app/api/desktop/chantiers/launch/route.ts", import.meta.url),
  "utf-8",
);

describe("chantier launch planning bridge", () => {
  it("converts the commercial provision to firm planning after launch", () => {
    expect(source).toContain("createPlanningRepository");
    expect(source).toContain("convertPlanningProvisionToFirm");
    expect(source).toContain("affair.id");
    expect(source).toContain("mutation.focusChantierId");
  });
});
