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

  it("wires weekly provisional editing into the same grand planning grid", () => {
    expect(apiSource).toContain('input.action === "setProvisionalHours"');
    expect(uiSource).toContain('action: "setProvisionalHours"');
    expect(uiSource).toContain("POTENTIEL");
    expect(uiSource).toContain("planningPotentialWeekCell");
    expect(uiSource).toContain("Dispo F+P");
  });

  it("shows a separate unallocated provision panel and keeps it distinct from firm load", () => {
    expect(uiSource).toContain("Charges commerciales à répartir");
    expect(uiSource).toContain("Affaires non confirmées");
    expect(uiSource).toContain("Ces heures ne sont pas comptées dans la charge ferme.");
    expect(uiSource).toContain("provisionalUnallocated");
  });
});
