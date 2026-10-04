import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../src/app/planning/page.tsx", import.meta.url), "utf-8");
const apiSource = readFileSync(
  new URL("../src/app/api/me/planning-preferences/route.ts", import.meta.url),
  "utf-8",
);
const uiSource = readFileSync(
  new URL("../src/components/grand-planning-workspace.tsx", import.meta.url),
  "utf-8",
);

describe("planning potential collapse preference", () => {
  it("uses the authenticated user's saved preference and defaults legacy users to expanded", () => {
    expect(pageSource).toContain("user.planningPotentialCollapsed");
    expect(apiSource).toContain("planningPotentialCollapsed");
    expect(uiSource).toContain("initialPotentialCollapsed");
  });

  it("keeps the POTENTIEL divider visible while conditionally hiding only provisional rows", () => {
    expect(uiSource).toContain("planningPotentialToggle");
    expect(uiSource).toContain("aria-expanded={!potentialCollapsed}");
    expect(uiSource).toContain('potentialCollapsed ? "isCollapsed" : ""');
    expect(uiSource).toContain("<strong>POTENTIEL</strong>");
  });

  it("persists only the visual preference through the personal preferences API", () => {
    expect(uiSource).toContain('fetch("/api/me/planning-preferences"');
    expect(uiSource).toContain("planningPotentialCollapsed: next");
    expect(apiSource).toContain("target.planningPotentialCollapsed");
  });
  it("sends the displayed preference as the stale-write precondition", () => {
    expect(uiSource).toContain(
      "expectedPlanningPotentialCollapsed: potentialCollapsed",
    );
    expect(apiSource).toContain("PREFERENCE_VERSION_REQUIRED");
    expect(apiSource).toContain("PREFERENCE_VERSION_CONFLICT");
    expect(apiSource).toContain(
      "current !== body.expectedPlanningPotentialCollapsed",
    );
  });

});
