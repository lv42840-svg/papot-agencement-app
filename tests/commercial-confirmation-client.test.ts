import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  new URL("../src/app/api/desktop/commercial/route.ts", import.meta.url),
  "utf-8",
);

describe("commercial affair confirmation", () => {
  it("does not block confirmation on an incomplete client sheet", () => {
    expect(route).not.toContain("assertCommercialClientReadyForConfirmation");
    expect(route).toContain("validateConfirmationQuoteSelection");
  });
});
