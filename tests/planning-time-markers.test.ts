import { describe, expect, it } from "vitest";
import {
  FRENCH_MONTHS,
  buildGrandPlanningWeekMeta,
  groupGrandPlanningMonths,
  isoWeekKey,
  isoWeekMonday,
  weekDateRangeLabel,
  isPlanningWeekPast,
} from "../src/lib/planning/time-markers";

describe("grand planning time markers", () => {
  it("computes ISO week Mondays across year boundaries", () => {
    expect(isoWeekMonday("2026-W01").toISOString().slice(0, 10)).toBe("2025-12-29");
    expect(isoWeekMonday("2026-W40").toISOString().slice(0, 10)).toBe("2026-09-28");
  });

  it("computes the current ISO week from a calendar date", () => {
    expect(isoWeekKey(new Date(2026, 8, 28, 12))).toBe("2026-W40");
  });

  it("shows exact Monday to Sunday dates on hover", () => {
    expect(weekDateRangeLabel("2026-W40")).toBe("28/09 au 04/10");
  });

  it("attaches a crossing week to the month of its Monday", () => {
    const meta = buildGrandPlanningWeekMeta(["2026-W40"], new Date(2026, 8, 28, 12))[0];

    expect(meta.monthLabel).toBe(FRENCH_MONTHS[8]);
    expect(meta.monthLabel).toBe("SEPTEMBRE");
    expect(meta.isCurrent).toBe(true);
    expect(meta.isPast).toBe(false);
  });

  it("marks past weeks and month changes without altering week data", () => {
    const weeks = ["2026-W39", "2026-W40", "2026-W41", "2026-W44"];
    const meta = buildGrandPlanningWeekMeta(weeks, new Date(2026, 8, 28, 12));

    expect(meta.map((item) => item.week)).toEqual(weeks);
    expect(meta[0].isPast).toBe(true);
    expect(meta[1].isCurrent).toBe(true);
    expect(meta[2].isPast).toBe(false);
    expect(meta[2].monthLabel).toBe("OCTOBRE");
    expect(meta[2].startsMonth).toBe(true);
    expect(meta[3].monthLabel).toBe("OCTOBRE");
    expect(meta[3].startsMonth).toBe(false);
  });

  it("locks a week only from the Monday of the following week", () => {
    expect(isPlanningWeekPast("2026-W40", new Date(2026, 9, 4, 12))).toBe(false);
    expect(isPlanningWeekPast("2026-W40", new Date(2026, 9, 5, 0, 1))).toBe(true);
    expect(isPlanningWeekPast("2026-W41", new Date(2026, 9, 5, 0, 1))).toBe(false);
  });

  it("groups consecutive weekly columns under their French month label", () => {
    const meta = buildGrandPlanningWeekMeta(
      ["2026-W39", "2026-W40", "2026-W41", "2026-W42", "2026-W43", "2026-W44"],
      new Date(2026, 8, 28, 12),
    );

    expect(groupGrandPlanningMonths(meta)).toEqual([
      { key: "2026-W39:SEPTEMBRE", label: "SEPTEMBRE", span: 2 },
      { key: "2026-W41:OCTOBRE", label: "OCTOBRE", span: 4 },
    ]);
  });
});
