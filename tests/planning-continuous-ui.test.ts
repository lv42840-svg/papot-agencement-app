import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspace = readFileSync(
  new URL("../src/components/grand-planning-workspace.tsx", import.meta.url),
  "utf-8",
);
const grid = readFileSync(
  new URL("../src/components/planning-excel-grid.tsx", import.meta.url),
  "utf-8",
);
const api = readFileSync(
  new URL("../src/app/api/desktop/planning/route.ts", import.meta.url),
  "utf-8",
);

describe("continuous grand planning", () => {
  it("provides rolling multi-year snapshots after data edits, not just for initial loading", () => {
    expect(api).toContain("parseYearRange");
    expect(api).toContain("planningYearWeekIdsRange");
    expect(api).toContain("body.endYear");
    expect(workspace).toContain("endYear: snapshot.endYear");
    expect(workspace).toContain("snapshot.endYear + 1");
    expect(workspace).toContain("onScroll={handlePlanningScroll}");
    expect(workspace).toContain("restoreScrollRef");
  });

  it("renders a single totals row with three activity values per week", () => {
    expect(grid.match(/className="excelActivityTotalRow"/g)).toHaveLength(1);
    expect(grid).toContain("TOTAL CHANTIERS");
    expect(grid).toContain(
      "tripleValues(ACTIVITIES.map((activity) => weeklyTotalFor(activity, week)))",
    );
    expect(grid).toContain("month.key.slice(0, 4)");
  });

  it("lets the user dismiss and reopen each pending-hours alert without deleting work", () => {
    expect(workspace).toContain("hiddenUnallocated");
    expect(workspace).toContain("hiddenProvisional");
    expect(workspace).toContain("toggleUnallocated(true)");
    expect(workspace).toContain("toggleUnallocated(false)");
    expect(workspace).toContain("toggleProvisional(true)");
    expect(workspace).toContain("toggleProvisional(false)");
    expect(workspace).toContain("window.sessionStorage");
  });
});
