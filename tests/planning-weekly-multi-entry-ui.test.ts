import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const board = readFileSync(
  new URL("../src/components/weekly-team-board.tsx", import.meta.url),
  "utf8",
);
const cell = readFileSync(
  new URL("../src/components/weekly-board-day-cell.tsx", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../src/app/api/desktop/planning/weekly-board/route.ts", import.meta.url),
  "utf8",
);

describe("weekly team board extended UI", () => {
  it("can add, edit and delete multiple categorized assignments within the same day", () => {
    expect(board).toContain("assignments.get(key) ?? []");
    expect(cell).toContain("rows.map((row)");
    expect(cell).toContain("saveDailyEntry");
    expect(cell).toContain("deleteDailyEntry");
    expect(cell).toContain("weeklyBoardAddEntry");
    expect(cell).toContain("Texte libre");
    expect(cell).toContain("Atelier");
    expect(cell).toContain("Pose");
    expect(cell).toContain("BE");
  });

  it("marks national holidays and extracts chantier-by-chantier hours of the selected week", () => {
    expect(board).toContain('className={holiday ? "weeklyBoardDayHead isHoliday"');
    expect(board).toContain("firmChantiers.map");
    expect(board).toContain("provisionalChantiers.map");
    expect(board).toContain("row.name");
    expect(board).toContain("row.workshop");
    expect(board).toContain("row.install");
    expect(route).toContain("frenchNationalPublicHolidayLabels");
    expect(route).toContain("weeklyChantierHours");
  });

  it("keeps server-side write authorization and read-only totals", () => {
    expect(route).toContain('requireModuleRequestContext("planning", "WRITE")');
    expect(route).toContain('requireSpecialPermission(context.user, "planning.manage_schedules")');
    expect(route).toContain("assertPlanningWeekEditable(input.week)");
    expect(route).toContain("applyWeeklyBoardEntry");
    expect(board).toContain("Les affectations ne modifient pas les heures du grand planning.");
  });
});
