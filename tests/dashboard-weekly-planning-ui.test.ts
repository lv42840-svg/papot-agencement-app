import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const home = readFileSync(new URL("../src/app/desktop-ready/page.tsx", import.meta.url), "utf8");
const component = readFileSync(
  new URL("../src/components/dashboard-weekly-planning.tsx", import.meta.url),
  "utf8",
);
const api = readFileSync(
  new URL("../src/app/api/desktop/planning/weekly-board/route.ts", import.meta.url),
  "utf8",
);

describe("dashboard real weekly planning preview", () => {
  it("replaces the fictitious calendar and stale fixed-week links", () => {
    expect(home).toContain("<DashboardWeeklyPlanning initialWeek={currentWeek} />");
    expect(home).toContain("currentDashboardPlanningWeek()");
    expect(home).toContain("href={\`/planning/\${currentWeek}\`}");
    expect(home).not.toContain("CalendarPreview");
    expect(home).not.toContain("/planning/2026-S38");
    expect(home).not.toContain("Le vrai planning sera construit ici");
  });

  it("reads current weekly planning from the existing authorized API", () => {
    expect(component).toContain("/api/desktop/planning/weekly-board?week=");
    expect(component).toContain('cache: "no-store"');
    expect(api).toContain('requireModuleRequestContext("planning", "READ")');
    expect(component).toContain("data.people.map");
    expect(component).toContain("data.dates.map");
    expect(component).toContain("data?.assignments");
    expect(component).toContain("data?.absences");
    expect(component).toContain("data?.holidays");
  });

  it("provides week arrows and a live link to the editable full weekly board", () => {
    expect(component).toContain('aria-label="Semaine précédente"');
    expect(component).toContain('aria-label="Semaine suivante"');
    expect(component).toContain('href={"/planning/" + week}');
    expect(component).toContain("shiftDashboardPlanningWeek(previous, 1)");
    expect(component).toContain("Cette semaine");
  });
});
