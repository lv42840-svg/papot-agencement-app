import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const board = readFileSync(
  new URL("../src/components/weekly-team-board.tsx", import.meta.url),
  "utf8",
);
const personnel = readFileSync(
  new URL("../src/components/grand-planning-workspace.tsx", import.meta.url),
  "utf8",
);
const api = readFileSync(
  new URL("../src/app/api/desktop/planning/weekly-board/route.ts", import.meta.url),
  "utf8",
);

describe("compact weekly print and independent personnel visibility", () => {
  it("prints only a small week number, not the dashboard header or chantier summary", () => {
    expect(board).toContain('className="weeklyBoardPrintWeek"');
    expect(board).toContain("S{week.slice(-2)} · {week.slice(0, 4)}");
    expect(board).toContain("window.print()");
    const printRules = board.slice(board.indexOf("@media print"));
    expect(printRules).toContain(".weeklyBoardTop,");
    expect(printRules).toContain(".weeklyBoardTopline,");
    expect(printRules).toContain(".weeklyBoardTabs,");
    expect(printRules).toContain("display: none !important");
    expect(printRules).toContain(".weeklyBoardPrintWeek {");
    expect(printRules).toContain("font-size: 10pt !important");
  });

  it("fits a ten-person week by compacting rows, entry cards and margins in A4 landscape", () => {
    expect(board).toMatch(/@page\s*\{\s*size:\s*A4 landscape;\s*margin:\s*5mm;/);
    const css = board.slice(board.indexOf("@media print"));
    expect(css).toContain("min-width: 0 !important");
    expect(css).toContain("table-layout: fixed !important");
    expect(css).toContain(".weeklyBoardDayContent {");
    expect(css).toContain("gap: 2px !important");
    expect(css).toContain(".weeklyBoardPerson small {");
    expect(css).toContain("display: none !important");
    expect(css).toContain("font-size: 7pt !important");
    expect(css).toContain("break-inside: avoid !important");
    expect(css).toContain("print-color-adjust: exact !important");
    expect(board.indexOf("@media print")).toBeGreaterThan(board.indexOf(".weeklyBoardTop {"));
  });

  it("hides people only from the weekly board, never from actual team capacity", () => {
    expect(api).toContain("!person.hiddenInWeeklyBoard");
    expect(api).toMatch(/buildWeeklyCapacityIndicators\(\s*\[week\],\s*allPeople,/);
    expect(personnel).toContain("Masquer une personne du petit planning ne retire pas ses heures");
    expect(personnel).toContain("Visible au petit planning");
  });
});
