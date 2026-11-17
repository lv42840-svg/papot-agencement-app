import { describe, expect, it } from "vitest";
import { NEW_STAFF_WEEKLY_SCHEDULE, buildWeeklyCapacityIndicators } from "../src/lib/planning/capacity";
import { createInitialPlanningPayload } from "../src/lib/planning/domain";
import { applyPlanningAbsenceRangeMutation } from "../src/lib/planning/mutations";

const userId = "11111111-1111-4111-8111-111111111111";
const active = new Set([userId]);
const people = [{ userId, countsInMacroCapacity: true, weeklySchedule: NEW_STAFF_WEEKLY_SCHEDULE }];
const payload = () => ({ ...createInitialPlanningPayload(), peopleCapacity: people });
const range = { action: "setAbsenceRange" as const, userId, type: "VACATION" as const, startDate: "2026-11-09", endDate: "2026-11-17" };

describe("absence date à date", () => {
  it("exclut le 11 novembre férié, les week-ends et compte les jours des deux semaines", () => {
    const result = applyPlanningAbsenceRangeMutation(payload(), range, active);
    expect(result.absences.map((a) => a.date)).toEqual([
      "2026-11-09", "2026-11-10", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17",
    ]);
    expect(buildWeeklyCapacityIndicators(["2026-W46", "2026-W47"], people, new Map(), result.absences)).toHaveLength(2);
  });
  it("remplace proprement une même plage sans double comptage ni IDs instables", () => {
    const first = applyPlanningAbsenceRangeMutation(payload(), range, active);
    const again = applyPlanningAbsenceRangeMutation(first, { ...range, type: "SICK" }, active);
    expect(again.absences).toHaveLength(first.absences.length);
    expect(again.absences.map((row) => row.id)).toEqual(first.absences.map((row) => row.id));
    expect(again.absences.every((row) => row.type === "SICK")).toBe(true);
  });
  it("rejette une fin antérieure au début et les plages trop longues", () => {
    expect(() => applyPlanningAbsenceRangeMutation(payload(), { ...range, endDate: "2026-11-01" }, active)).toThrow("PLANNING_ABSENCE_RANGE_INVALID");
    expect(() => applyPlanningAbsenceRangeMutation(payload(), { ...range, endDate: "2029-11-18" }, active)).toThrow("PLANNING_ABSENCE_RANGE_INVALID");
  });
});
