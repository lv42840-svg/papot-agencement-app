import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const apiSource = readFileSync(
  new URL("../src/app/api/desktop/planning/route.ts", import.meta.url),
  "utf-8",
);
const uiSource = readFileSync(
  new URL("../src/components/grand-planning-workspace.tsx", import.meta.url),
  "utf-8",
);

describe("grand planning commercial provision bridge", () => {
  it("loads commercial provisions into the planning snapshot without storing totals in planning", () => {
    expect(apiSource).toContain("createCommercialRepository(context).load()");
    expect(apiSource).toContain("buildCommercialProvisionRows(commercial, planning, year)");
    expect(apiSource).toContain("provisionalRows");
  });

  it("shows a separate unallocated provision panel and keeps it distinct from firm load", () => {
    expect(uiSource).toContain("Charges commerciales à répartir");
    expect(uiSource).toContain("Affaires non confirmées");
    expect(uiSource).toContain("Ces heures ne sont pas comptées dans la charge ferme.");
    expect(uiSource).toContain("provisionalUnallocated");
    expect(uiSource).toContain("activity.remainingHours");
  });

  it("edits provisional hours in the same annual table with a lighter visual treatment", () => {
    expect(apiSource).toContain('input.action === "setProvisionHours"');
    expect(uiSource).toContain('action: "setProvisionHours"');
    expect(uiSource).toContain("planningProvisionRow");
    expect(uiSource).toContain("planningProvisionCaseCell");
    expect(uiSource).toContain("Provisionnel · {item.statusLabel}");
  });
});
