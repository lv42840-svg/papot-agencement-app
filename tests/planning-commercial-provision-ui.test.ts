import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const apiSource = readFileSync(
  new URL("../src/app/api/desktop/planning/route.ts", import.meta.url),
  "utf-8",
);
const workspaceSource = readFileSync(
  new URL("../src/components/grand-planning-workspace.tsx", import.meta.url),
  "utf-8",
);
const gridSource = readFileSync(
  new URL("../src/components/planning-excel-grid.tsx", import.meta.url),
  "utf-8",
);

describe("grand planning commercial provision bridge", () => {
  it("loads provisional cases and retains firm versus provisional fields", () => {
    expect(apiSource).toContain("createCommercialRepository().load()");
    expect(apiSource).toContain(
      "buildCommercialProvisionRows(commercial, planning, year, endYear)",
    );
    expect(apiSource).toContain("provisionalRows");
  });

  it("keeps the unallocated provisional section separate from firm work", () => {
    expect(workspaceSource).toContain("Charges commerciales à répartir");
    expect(workspaceSource).toContain("Ces heures ne sont pas comptées dans la charge ferme.");
    expect(workspaceSource).toContain("provisionalUnallocated");
  });

  it("displays distinct firm and provisional capacity indicators", () => {
    expect(apiSource).toContain("provisionalLoadByWeek");
    expect(gridSource).toContain("firmAvailableHours");
    expect(gridSource).toContain("availableWithProvisionHours");
    expect(gridSource).toContain("Disponible ferme");
    expect(gridSource).toContain("Disponible avec potentiel");
  });

  it("keeps potential affairs visibly separated, with collapsible rows", () => {
    expect(gridSource).toContain("excelPotentialDivider");
    expect(gridSource).toContain("CHARGES PROVISIONNELLES");
    expect(gridSource).toMatch(/!potentialCollapsed\s*&&\s*snapshot\.provisionalRows\.map/);
  });

  it("allows authorized reordering of provisioned cases", () => {
    expect(apiSource).toContain('input.action === "setPotentialOrder"');
    expect(workspaceSource).toContain('action: "setPotentialOrder"');
    expect(gridSource).toContain("onMoveProvision(item.caseId, -1)");
    expect(gridSource).toContain("onMoveProvision(item.caseId, 1)");
  });

  it("edits provisional hours in the same Excel grid with a lighter visual treatment", () => {
    expect(apiSource).toContain('input.action === "setProvisionHours"');
    expect(workspaceSource).toContain('action: "setProvisionHours"');
    expect(gridSource).toMatch(/hoursInput\(\s*"provisional"/);
    expect(workspaceSource).toContain(".excelProvisionalRow .excelWeekCell");
  });
});
