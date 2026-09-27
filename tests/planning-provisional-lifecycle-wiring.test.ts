import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const commercialRoute = readFileSync(
  new URL("../src/app/api/desktop/commercial/route.ts", import.meta.url),
  "utf-8",
);
const launchRoute = readFileSync(
  new URL("../src/app/api/desktop/chantiers/launch/route.ts", import.meta.url),
  "utf-8",
);

describe("provisional planning lifecycle wiring", () => {
  it("purges weekly provision allocations when a commercial affair closes", () => {
    expect(commercialRoute).toContain("isCommercialClosed(focusedCase)");
    expect(commercialRoute).toContain("removePlanningProvisionalAllocationsForCases");
  });

  it("converts the same weekly provision schedule to firm at chantier launch", () => {
    expect(launchRoute).toContain("convertPlanningProvisionToFirm");
    expect(launchRoute).toContain("affair.id");
  });
});
