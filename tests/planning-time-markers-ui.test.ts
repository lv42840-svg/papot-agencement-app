import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspaceSource = readFileSync(
  new URL("../src/components/grand-planning-workspace.tsx", import.meta.url),
  "utf-8",
);
const gridSource = readFileSync(
  new URL("../src/components/planning-excel-grid.tsx", import.meta.url),
  "utf-8",
);

describe("grand planning temporal markers UI", () => {
  it("renders sticky month and week headers with a current-week marker", () => {
    expect(gridSource).toContain('className="excelMonthRow"');
    expect(gridSource).toContain('className="excelWeekRow"');
    expect(gridSource).toContain("groupGrandPlanningMonths");
    expect(gridSource).toContain("data-planning-week={meta.week}");
    expect(gridSource).toContain("excelCurrentWeek");
    expect(gridSource).toContain("excelPastWeek");
    expect(gridSource).toContain("excelMonthStart");
  });

  it("displays Sxx and uses the date range as a tooltip", () => {
    expect(gridSource).toContain("meta.week.slice(-2)");
    expect(gridSource).toContain("title={meta.dateRangeLabel}");
  });

  it("locks editing for past weeks and read-only users", () => {
    expect(gridSource).toContain("metaByWeek.get(week)?.isPast");
    expect(gridSource).toContain("!snapshot.capabilities.canEditMacro");
    expect(gridSource).toContain("disabled={readOnly}");
  });

  it("centers the scroll on the current week without a dedicated button", () => {
    expect(workspaceSource).toContain("planningScrollerRef.current");
    expect(workspaceSource).toContain("scroller.scrollLeft");
    expect(workspaceSource).not.toContain(">Semaine en cours<");
  });
});
