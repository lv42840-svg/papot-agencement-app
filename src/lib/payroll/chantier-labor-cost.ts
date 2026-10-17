import { DEFAULT_WEEKLY_SCHEDULE, isoWeekDates, scheduleHoursForDate } from "@/lib/planning/capacity";
import type { PlanningActualHours } from "@/lib/planning/domain";
import type { PlanningPersonCapacity } from "@/lib/planning/capacity";
import type { MonthlyLaborCostRecord } from "./monthly-labor-costs";

/**
 * Weekly actual hours are recorded without dates. For a week spanning two months,
 * distribute those hours using the employee's standard working-day capacity.
 * Holidays are excluded. When the standard capacity is zero, use weekdays equally.
 * This is an estimate: no daily distribution is invented or written back to planning.
 */
export function monthlySharesForWeek(
  week: string,
  schedule: PlanningPersonCapacity["weeklySchedule"] = DEFAULT_WEEKLY_SCHEDULE,
): Array<{ month: string; fraction: number }> {
  const dates = isoWeekDates(week);
  let weights = dates.map((date) => scheduleHoursForDate(schedule, date));
  if (weights.every((value) => value === 0)) {
    weights = dates.map((date) => {
      const day = date.getUTCDay();
      return day > 0 && day < 6 ? 1 : 0;
    });
  }
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  const byMonth = new Map<string, number>();
  dates.forEach((date, index) => {
    const month = date.toISOString().slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + weights[index] / weightSum);
  });
  return [...byMonth].filter(([, fraction]) => fraction > 0).map(([month, fraction]) => ({ month, fraction }));
}

/**
 * Returns null rather than understating real labor costs whenever a contributing
 * person's monthly employer-cost record is missing. Original hours are untouched.
 * One rounding to whole cents is applied at the chantier level.
 */
export function calculateChantierLaborCostCents(
  chantierId: string,
  actualHours: readonly PlanningActualHours[],
  records: readonly MonthlyLaborCostRecord[],
  personCapacities: readonly PlanningPersonCapacity[],
): number | null {
  const entries = actualHours.filter((row) => row.chantierId === chantierId && row.hours > 0);
  if (entries.length === 0) return 0;

  const byPersonMonth = new Map(
    records.map((record) => [record.personId + ":" + record.month, record]),
  );
  const byPerson = new Map(personCapacities.map((person) => [person.userId, person.weeklySchedule]));
  let totalCents = 0;

  for (const entry of entries) {
    for (const split of monthlySharesForWeek(entry.week, byPerson.get(entry.userId))) {
      const cost = byPersonMonth.get(entry.userId + ":" + split.month);
      if (!cost || cost.workedHours <= 0) return null;
      totalCents += entry.hours * split.fraction * (cost.employerCostCents / cost.workedHours);
    }
  }
  return Math.round(totalCents);
}
