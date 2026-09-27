import { z } from "zod";

const weekdayHoursSchema = z.object({
  monday: z.number().finite().nonnegative().max(24),
  tuesday: z.number().finite().nonnegative().max(24),
  wednesday: z.number().finite().nonnegative().max(24),
  thursday: z.number().finite().nonnegative().max(24),
  friday: z.number().finite().nonnegative().max(24),
  saturday: z.number().finite().nonnegative().max(24),
  sunday: z.number().finite().nonnegative().max(24),
});

export const planningPersonCapacitySchema = z.object({
  userId: z.string().uuid(),
  countsInMacroCapacity: z.boolean(),
  weeklySchedule: weekdayHoursSchema,
});

export type PlanningPersonCapacity = z.infer<typeof planningPersonCapacitySchema>;
export type PlanningWeekCapacity = {
  week: string;
  totalCapacityHours: number;
  firmLoadHours: number;
  firmAvailableHours: number;
};

export const DEFAULT_WEEKLY_SCHEDULE = {
  monday: 7.8,
  tuesday: 7.8,
  wednesday: 7.8,
  thursday: 7.8,
  friday: 7.8,
  saturday: 0,
  sunday: 0,
} satisfies z.infer<typeof weekdayHoursSchema>;

export function weeklyScheduleHours(schedule: PlanningPersonCapacity["weeklySchedule"]): number {
  return Object.values(schedule).reduce((sum, hours) => sum + hours, 0);
}

export function buildWeeklyCapacityIndicators(
  weeks: string[],
  people: PlanningPersonCapacity[],
  firmLoadByWeek: ReadonlyMap<string, number>,
): PlanningWeekCapacity[] {
  const baseCapacity = people
    .filter((person) => person.countsInMacroCapacity)
    .reduce((sum, person) => sum + weeklyScheduleHours(person.weeklySchedule), 0);

  return weeks.map((week) => {
    const firmLoadHours = firmLoadByWeek.get(week) ?? 0;
    return {
      week,
      totalCapacityHours: baseCapacity,
      firmLoadHours,
      firmAvailableHours: baseCapacity - firmLoadHours,
    };
  });
}
