import { z } from "zod";
import type { PlanningAbsence } from "./domain";

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
  provisionalLoadHours: number;
  firmAvailableHours: number;
  availableWithProvisionHours: number;
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

type WeekdayKey = keyof PlanningPersonCapacity["weeklySchedule"];

const WEEKDAY_KEYS: WeekdayKey[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const cc = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(cc / 4);
  const k = cc % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateId(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function frenchNationalPublicHolidayIds(year: number): Set<string> {
  const easter = easterSunday(year);
  const fixed = [
    [1, 1],
    [5, 1],
    [5, 8],
    [7, 14],
    [8, 15],
    [11, 1],
    [11, 11],
    [12, 25],
  ] as const;
  const ids = new Set(
    fixed.map(([month, day]) => dateId(new Date(Date.UTC(year, month - 1, day)))),
  );
  ids.add(dateId(addUtcDays(easter, 1)));
  ids.add(dateId(addUtcDays(easter, 39)));
  ids.add(dateId(addUtcDays(easter, 50)));
  return ids;
}

export function isoWeekDates(weekId: string): Date[] {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!match) throw new Error("PLANNING_WEEK_INVALID");
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  return Array.from({ length: 7 }, (_, index) => addUtcDays(monday, index));
}

export function scheduleHoursForDate(
  schedule: PlanningPersonCapacity["weeklySchedule"],
  date: Date,
): number {
  const holidays = frenchNationalPublicHolidayIds(date.getUTCFullYear());
  if (holidays.has(dateId(date))) return 0;
  const day = date.getUTCDay();
  const index = day === 0 ? 6 : day - 1;
  return schedule[WEEKDAY_KEYS[index]];
}

export function weeklyScheduleHoursForWeek(
  schedule: PlanningPersonCapacity["weeklySchedule"],
  weekId: string,
): number {
  const dates = isoWeekDates(weekId);
  return dates.reduce((sum, date) => sum + scheduleHoursForDate(schedule, date), 0);
}

export function buildWeeklyCapacityIndicators(
  weeks: string[],
  people: PlanningPersonCapacity[],
  firmLoadByWeek: ReadonlyMap<string, number>,
  absences: PlanningAbsence[] = [],
  provisionalLoadByWeek: ReadonlyMap<string, number> = new Map(),
): PlanningWeekCapacity[] {
  const countedPeople = people.filter((person) => person.countsInMacroCapacity);

  return weeks.map((week) => {
    const dates = isoWeekDates(week);
    const totalCapacityHours = countedPeople.reduce((sum, person) => {
      const absencesByDate = new Map(
        absences
          .filter((absence) => absence.userId === person.userId)
          .map((absence) => [absence.date, absence]),
      );
      return (
        sum +
        dates.reduce((personWeek, date) => {
          const scheduled = scheduleHoursForDate(person.weeklySchedule, date);
          const absence = absencesByDate.get(dateId(date));
          const unavailable = absence ? Math.min(absence.hours, scheduled) : 0;
          return personWeek + Math.max(0, scheduled - unavailable);
        }, 0)
      );
    }, 0);
    const firmLoadHours = firmLoadByWeek.get(week) ?? 0;
    const provisionalLoadHours = provisionalLoadByWeek.get(week) ?? 0;
    const firmAvailableHours = totalCapacityHours - firmLoadHours;
    return {
      week,
      totalCapacityHours,
      firmLoadHours,
      provisionalLoadHours,
      firmAvailableHours,
      availableWithProvisionHours: firmAvailableHours - provisionalLoadHours,
    };
  });
}
