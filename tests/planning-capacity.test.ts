import { describe, expect, it } from "vitest";
import {
  buildWeeklyCapacityIndicators,
  DEFAULT_WEEKLY_SCHEDULE,
  frenchNationalPublicHolidayIds,
  weeklyScheduleHours,
  weeklyScheduleHoursForWeek,
} from "../src/lib/planning/capacity";

const lucienId = "11111111-1111-4111-8111-111111111111";
const nadiaId = "22222222-2222-4222-8222-222222222222";

describe("grand planning weekly capacity", () => {
  it("uses the individual weekly schedule as the reference capacity", () => {
    expect(weeklyScheduleHours(DEFAULT_WEEKLY_SCHEDULE)).toBe(39);
  });

  it("knows the automatic French national public holidays", () => {
    const holidays = frenchNationalPublicHolidayIds(2026);
    expect(holidays.has("2026-05-01")).toBe(true);
    expect(holidays.has("2026-05-14")).toBe(true);
    expect(holidays.has("2026-05-25")).toBe(true);
    expect(holidays.has("2026-12-25")).toBe(true);
  });

  it("sets the scheduled capacity to zero on a public holiday", () => {
    expect(weeklyScheduleHoursForWeek(DEFAULT_WEEKLY_SCHEDULE, "2026-W20")).toBe(31.2);
  });

  it("includes only people explicitly counted in macro capacity", () => {
    const indicators = buildWeeklyCapacityIndicators(
      ["2026-W40"],
      [
        {
          userId: lucienId,
          countsInMacroCapacity: true,
          weeklySchedule: DEFAULT_WEEKLY_SCHEDULE,
        },
        {
          userId: nadiaId,
          countsInMacroCapacity: false,
          weeklySchedule: {
            ...DEFAULT_WEEKLY_SCHEDULE,
            monday: 8,
          },
        },
      ],
      new Map([["2026-W40", 30]]),
    );

    expect(indicators[0]).toEqual({
      week: "2026-W40",
      totalCapacityHours: 39,
      firmLoadHours: 30,
      firmAvailableHours: 9,
    });
  });

  it("allows negative availability when firm load exceeds capacity", () => {
    const indicators = buildWeeklyCapacityIndicators(
      ["2026-W40"],
      [
        {
          userId: lucienId,
          countsInMacroCapacity: true,
          weeklySchedule: DEFAULT_WEEKLY_SCHEDULE,
        },
      ],
      new Map([["2026-W40", 45]]),
    );

    expect(indicators[0]?.firmAvailableHours).toBe(-6);
  });
});
