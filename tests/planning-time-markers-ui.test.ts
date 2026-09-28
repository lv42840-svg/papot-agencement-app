import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const uiSource = readFileSync(
  new URL("../src/components/grand-planning-workspace.tsx", import.meta.url),
  "utf-8",
);

describe("grand planning temporal markers UI", () => {
  it("renders sticky month and week rows with the current week hook", () => {
    expect(uiSource).toContain('className="planningMonthRow"');
    expect(uiSource).toContain('className="planningWeekRow"');
    expect(uiSource).toContain("groupGrandPlanningMonths");
    expect(uiSource).toContain("data-planning-week={week}");
    expect(uiSource).toContain("planningCurrentWeek");
    expect(uiSource).toContain("planningPastWeek");
    expect(uiSource).toContain("planningMonthStart");
  });

  it("keeps only Sxx permanently visible and exposes the date range as a tooltip", () => {
    expect(uiSource).toContain("<strong>{weekLabel(week)}</strong>");
    expect(uiSource).toContain("meta.dateRangeLabel");
  });

  it("locks firm and provisional inputs when the week is past", () => {
    expect(uiSource.split("weekMetaByWeek.get(week)?.isPast")).toHaveLength(3);
  });

  it("recenters automatically on the current week without adding a dedicated button", () => {
    expect(uiSource).toContain("planningScrollerRef.current");
    expect(uiSource).toContain("scroller.scrollLeft");
    expect(uiSource).not.toContain(">Semaine en cours<");
  });
});
