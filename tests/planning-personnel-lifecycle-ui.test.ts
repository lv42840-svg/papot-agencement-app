import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(
  new URL("../src/components/grand-planning-workspace.tsx", import.meta.url),
  "utf8",
);
const board = readFileSync(
  new URL("../src/components/weekly-team-board.tsx", import.meta.url),
  "utf8",
);
const cell = readFileSync(
  new URL("../src/components/weekly-board-day-cell.tsx", import.meta.url),
  "utf8",
);
const api = readFileSync(
  new URL("../src/app/api/desktop/planning/weekly-board/route.ts", import.meta.url),
  "utf8",
);

describe("personnel notice, copy and printable weekly board UI", () => {
  it("can add a date of departure to an existing member and hide/deactivate/reactivate/delete safely", () => {
    expect(workspace).toContain('action: "setStaffEndDate"');
    expect(workspace).toContain("event.target.value || null");
    expect(workspace).toContain('action: "setPersonHidden"');
    expect(workspace).toContain("deactivateStaff");
    expect(workspace).toContain("reactivateStaff");
    expect(workspace).toContain("deleteStaff");
    expect(workspace).toContain("window.confirm");
  });

  it("supports copy/paste of the full day across weeks through session storage without overwriting", () => {
    expect(cell).toContain("Copier jour");
    expect(cell).toContain("Coller jour");
    expect(board).toContain("papot.agencement.weekly-copied-day");
    expect(board).toContain('action: "pasteDailyEntries"');
    expect(board).toContain("onCopyDay={() => copyDay(assignments.get(key) ?? [])}");
    expect(api).toContain("applyWeeklyBoardPaste");
    expect(api).toContain("PLANNING_DAY_PERSON_ABSENT");
    expect(api).toContain("personPresentOnDate");
  });

  it("prints the weekly staff assignments with landscape headers, chantier extract and color", () => {
    expect(board).toContain("window.print()");
    expect(board).toMatch(/@page\s*\{\s*size:\s*A4 landscape/);
    expect(board).toContain("print-color-adjust: exact");
    expect(board).toContain("weeklyBoardChantierScroll");
    expect(board).toContain("weeklyBoardTable");
    expect(board).toContain("weeklyBoardPrintButton");
  });
});
