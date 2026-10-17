import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../src/app/planning/[weekId]/page.tsx", import.meta.url), "utf8");
const rootPage = readFileSync(new URL("../src/app/planning/page.tsx", import.meta.url), "utf8");
const board = readFileSync(new URL("../src/components/weekly-team-board.tsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/components/grand-planning-workspace.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/app/api/desktop/planning/weekly-board/route.ts", import.meta.url), "utf8");

describe("weekly team board navigation and connection", () => {
  it("opens real weekly page from grand planning with personnel access preserved", () => {
    expect(page).toContain("<WeeklyTeamBoard");
    expect(main).toContain("Petit planning");
    expect(rootPage).toContain('params.tab === "personnel"');
    expect(board).toContain('Gestion du personnel');
    expect(board).toContain('Semaine précédente');
    expect(board).toContain('Semaine suivante');
  });

  it("displays five days by staff with chantier suggestions, absence and the weekly grand planning totals", () => {
    expect(board).toContain('WEEKDAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"]');
    expect(board).toContain("data.people.map((person");
    expect(board).toContain("data.dates.map((date");
    expect(board).toContain('weekly-board-site-suggestions');
    expect(board).toContain("data.firm.workshop");
    expect(board).toContain("data.provisional.install");
    expect(board).toContain("data.capacity.firmAvailableHours");
    expect(board).toContain("absence.typeLabel");
    expect(board).toContain('action: "setDailyAssignment"');
  });

  it("guards both read and edit access, and derives figures from the existing grand planning calculation", () => {
    expect(api).toContain('requireModuleRequestContext("planning", "READ")');
    expect(api).toContain('requireModuleRequestContext("planning", "WRITE")');
    expect(api).toContain('requireSpecialPermission(context.user, "planning.manage_schedules")');
    expect(api).toContain("assertPlanningWeekEditable(input.week)");
    expect(api).toContain("buildFirmGrandPlanningRows");
    expect(api).toContain("buildCommercialProvisionRows");
    expect(api).toContain("buildWeeklyCapacityIndicators");
    expect(api).toContain("weekActivityHours");
  });
});
