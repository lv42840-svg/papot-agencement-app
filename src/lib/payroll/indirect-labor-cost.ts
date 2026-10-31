import type { PlanningPersonCapacity } from "../planning/capacity";
import type { PlanningIndirectHours } from "../planning/domain";
import { monthlySharesForWeek } from "./chantier-labor-cost";
import { resolveLaborCostForWorkedMonth, type MonthlyLaborCostRecord } from "./monthly-labor-costs";

export type IndirectLaborCostsPeriod = {
  savHours: number;
  generalHours: number;
  savCostCents: number | null;
  generalCostCents: number | null;
  totalCostCents: number | null;
  provisional: boolean;
};

type InternalBucket = { hours: number; costCents: number; complete: boolean };

function sumHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}

/**
 * SAV and general expenses are company-wide labor costs, never chantier costs.
 * Weeks spanning months use the same employee working-day prorata as chantier payroll.
 * Missing payroll values yield null costs, never an underestimated subtotal.
 */
export function calculateIndirectLaborCostsForPeriod(
  period: string,
  entries: readonly PlanningIndirectHours[],
  records: readonly MonthlyLaborCostRecord[],
  peopleCapacity: readonly PlanningPersonCapacity[],
  now = new Date(),
): IndirectLaborCostsPeriod {
  const byPersonMonth = new Map(
    records.map((record) => [record.personId + ":" + record.month, record]),
  );
  const schedules = new Map(peopleCapacity.map((person) => [person.userId, person.weeklySchedule]));
  let provisional = false;
  const buckets: Record<PlanningIndirectHours["category"], InternalBucket> = {
    SAV: { hours: 0, costCents: 0, complete: true },
    GENERAL: { hours: 0, costCents: 0, complete: true },
  };

  for (const entry of entries) {
    if (entry.hours <= 0) continue;
    for (const split of monthlySharesForWeek(entry.week, schedules.get(entry.userId))) {
      if (!split.month.startsWith(period)) continue;
      const bucket = buckets[entry.category];
      const hours = entry.hours * split.fraction;
      bucket.hours += hours;
      const resolved = resolveLaborCostForWorkedMonth(entry.userId, split.month, byPersonMonth, now);
      if (!resolved) {
        bucket.complete = false;
      } else {
        provisional ||= resolved.provisional;
        bucket.costCents += hours * (resolved.record.employerCostCents / resolved.record.workedHours);
      }
    }
  }

  const savCostCents = buckets.SAV.complete ? Math.round(buckets.SAV.costCents) : null;
  const generalCostCents = buckets.GENERAL.complete ? Math.round(buckets.GENERAL.costCents) : null;

  return {
    savHours: sumHours(buckets.SAV.hours),
    generalHours: sumHours(buckets.GENERAL.hours),
    savCostCents,
    generalCostCents,
    provisional: provisional && savCostCents !== null && generalCostCents !== null,
    totalCostCents:
      savCostCents === null || generalCostCents === null ? null : savCostCents + generalCostCents,
  };
}

/**
 * Preliminary company-margin indicator: planned margin from confirmed contracts
 * less realized SAV and overhead labor. Not the accounting result; actual purchases,
 * invoices, and other overhead are not included.
 */
export function calculateIndicativeCompanyMarginCents(
  plannedMarginCents: number | null,
  indirectCosts: IndirectLaborCostsPeriod,
): number | null {
  return plannedMarginCents === null || indirectCosts.totalCostCents === null
    ? null
    : plannedMarginCents - indirectCosts.totalCostCents;
}
