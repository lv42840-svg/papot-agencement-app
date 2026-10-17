import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../src/app/planning/page.tsx", import.meta.url), "utf-8");
const apiSource = readFileSync(
  new URL("../src/app/api/me/planning-preferences/route.ts", import.meta.url),
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

describe("planning potential collapse preference", () => {
  it("uses the authenticated user's saved preference and defaults legacy users to expanded", () => {
    expect(pageSource).toContain("user.planningPotentialCollapsed");
    expect(apiSource).toContain("planningPotentialCollapsed");
    expect(workspaceSource).toContain("initialPotentialCollapsed");
  });

  it("keeps the potential divider visible while hiding only its rows", () => {
    expect(gridSource).toContain("excelPotentialDivider");
    expect(gridSource).toContain("aria-expanded={!potentialCollapsed}");
    expect(gridSource).toContain("!potentialCollapsed && snapshot.provisionalRows.map");
    expect(gridSource).toContain("CHARGES PROVISIONNELLES");
  });

  it("persists the visual preference through the personal preferences API", () => {
    expect(workspaceSource).toContain('fetch("/api/me/planning-preferences"');
    expect(workspaceSource).toContain("planningPotentialCollapsed: next");
    expect(apiSource).toContain("target.planningPotentialCollapsed");
  });
});
