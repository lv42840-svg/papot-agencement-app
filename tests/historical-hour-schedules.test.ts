import { describe, expect, it } from "vitest";
import { freezeHourSchedules } from "../src/lib/planning/hour-schedules";
import { parsePlanningPayload } from "../src/lib/planning/domain";
import { DEFAULT_WEEKLY_SCHEDULE } from "../src/lib/planning/capacity";
import { calculateChantierLaborCostEstimate } from "../src/lib/payroll/chantier-labor-cost";
const id = "11111111-1111-4111-8111-111111111111";
describe("historical hour schedules", () => {
  it("keeps the monthly allocation and cost stable after a schedule change and correction", () => {
    const planning = parsePlanningPayload(null);
    planning.peopleCapacity = [
      { userId: id, countsInMacroCapacity: true, weeklySchedule: { ...DEFAULT_WEEKLY_SCHEDULE } },
    ];
    planning.actualHours = [
      { userId: id, chantierId: id, week: "2026-W40", activity: "BE", hours: 39 },
    ];
    const frozen = freezeHourSchedules(planning);
    const changed = structuredClone(frozen);
    changed.peopleCapacity[0].weeklySchedule = {
      monday: 0,
      tuesday: 0,
      wednesday: 0,
      thursday: 8,
      friday: 8,
      saturday: 0,
      sunday: 0,
    };
    const records = [
      {
        personId: id,
        month: "2026-09",
        employerCostCents: 200000,
        workedHours: 100,
        updatedAt: "2026-11-01T00:00:00Z",
        updatedBy: "Test",
      },
      {
        personId: id,
        month: "2026-10",
        employerCostCents: 400000,
        workedHours: 100,
        updatedAt: "2026-11-01T00:00:00Z",
        updatedBy: "Test",
      },
    ];
    const cost = (p: typeof planning) =>
      calculateChantierLaborCostEstimate(
        id,
        p.actualHours,
        records,
        p.peopleCapacity,
        new Date("2026-12-01T00:00:00Z"),
      ).costCents;
    expect(cost(changed)).toBe(cost(frozen));
    changed.actualHours[0] = {
      userId: id,
      chantierId: id,
      week: "2026-W40",
      activity: "BE",
      hours: 40,
    };
    const corrected = freezeHourSchedules(changed, frozen);
    expect(corrected.actualHours[0].scheduleAtEntry).toEqual(DEFAULT_WEEKLY_SCHEDULE);
    expect(corrected.actualHours[0].hours).toBe(40);
  });
});
