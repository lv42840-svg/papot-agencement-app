import { DEFAULT_WEEKLY_SCHEDULE, isoWeekDates, scheduleHoursForDate } from "../planning/capacity";
import type { PlanningActualHours } from "../planning/domain";
import type { PlanningPersonCapacity } from "@/lib/planning/capacity";
import { resolveLaborCostForWorkedMonth, type MonthlyLaborCostRecord } from "./monthly-labor-costs";

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
  return [...byMonth]
    .filter(([, fraction]) => fraction > 0)
    .map(([month, fraction]) => ({ month, fraction }));
}

/**
 * Returns null rather than understating real labor costs whenever a contributing
 * person's monthly employer-cost record is missing. Original hours are untouched.
 * One rounding to whole cents is applied at the chantier level.
 */
export type ChantierLaborCostEstimate = {
  costCents: number | null;
  provisional: boolean;
};

export function calculateChantierLaborCostEstimate(
  chantierId: string,
  actualHours: readonly PlanningActualHours[],
  records: readonly MonthlyLaborCostRecord[],
  personCapacities: readonly PlanningPersonCapacity[],
  now = new Date(),
): ChantierLaborCostEstimate {
  const entries = actualHours.filter((row) => row.chantierId === chantierId && row.hours > 0);
  if (entries.length === 0) return { costCents: 0, provisional: false };

  const byPersonMonth = new Map(
    records.map((record) => [record.personId + ":" + record.month, record]),
  );
  const byPerson = new Map(
    personCapacities.map((person) => [person.userId, person.weeklySchedule]),
  );
  let totalCents = 0;
  let provisional = false;

  for (const entry of entries) {
    for (const split of monthlySharesForWeek(
      entry.week,
      entry.scheduleAtEntry ?? byPerson.get(entry.userId),
    )) {
      const resolved = resolveLaborCostForWorkedMonth(
        entry.userId,
        split.month,
        byPersonMonth,
        now,
      );
      if (!resolved) return { costCents: null, provisional: false };
      provisional ||= resolved.provisional;
      totalCents +=
        entry.hours *
        split.fraction *
        (resolved.record.employerCostCents / resolved.record.workedHours);
    }
  }
  return { costCents: Math.round(totalCents), provisional };
}

/** Compatibility helper for callers that only require the monetary total. */
export function calculateChantierLaborCostCents(
  chantierId: string,
  actualHours: readonly PlanningActualHours[],
  records: readonly MonthlyLaborCostRecord[],
  personCapacities: readonly PlanningPersonCapacity[],
  now = new Date(),
): number | null {
  return calculateChantierLaborCostEstimate(chantierId, actualHours, records, personCapacities, now)
    .costCents;
}
