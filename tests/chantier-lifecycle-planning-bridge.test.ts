import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/app/api/desktop/chantiers/route.ts", import.meta.url),
  "utf-8",
);

describe("chantier lifecycle planning bridge", () => {
  it("removes firm planning when a chantier is marked done", () => {
    expect(source).toContain('input.action === "markDone"');
    expect(source).toContain("removeFirmPlanningForChantier");
    expect(source).toContain('stage = "sync-planning-lifecycle"');
  });

  it("reopens a chantier at the top without restoring weekly allocations", () => {
    expect(source).toContain('input.action === "reactivate"');
    expect(source).toContain('input.action === "unarchive"');
    expect(source).toContain("restoreFirmPlanningOrderForChantier");
  });
});
