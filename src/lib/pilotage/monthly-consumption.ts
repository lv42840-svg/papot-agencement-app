import type { PlanningPayload } from "../planning/domain";
import { monthlySharesForWeek } from "../payroll/chantier-labor-cost";
import { resolveLaborCostForWorkedMonth, type MonthlyLaborCostRecord } from "../payroll/monthly-labor-costs";
import { financialMonthSchema } from "./monthly-financial-result";

export type MonthlyConsumptionBucket = {
  hours: number;
  valuedCostCents: number | null;
  unvaluedHours: number;
};

export type MonthlyConsumption = {
  month: string;
  chantier: MonthlyConsumptionBucket;
  sav: MonthlyConsumptionBucket;
  generalExpenses: MonthlyConsumptionBucket;
  total: MonthlyConsumptionBucket;
  provisional: boolean;
  estimatedMonthSplit: boolean;
};

/**
 * Recorded hours only, not the full monthly payroll expense.
 * No chantier status filter: closed, archived and cancelled sites retain their consumed labor.
 * A null payroll input means no access to salary-derived costs, not a free hour.
 */
export function calculateMonthlyConsumption(
  month: string,
  planning: Pick<PlanningPayload, "actualHours" | "indirectHours" | "peopleCapacity">,
  records: readonly MonthlyLaborCostRecord[] | null,
  now = new Date(),
): MonthlyConsumption {
  financialMonthSchema.parse(month);
  const schedules = new Map(planning.peopleCapacity.map((person) => [person.userId, person.weeklySchedule]));
  const rates = new Map<string, MonthlyLaborCostRecord>();
  for (const record of records ?? []) {
    const key = `${record.personId}:${record.month}`;
    if (rates.has(key)) throw new Error("MONTHLY_LABOR_COST_DUPLICATE");
    rates.set(key, record);
  }
  const buckets = {
    chantier: { hours: 0, cents: 0, unvaluedHours: 0 },
    sav: { hours: 0, cents: 0, unvaluedHours: 0 },
    generalExpenses: { hours: 0, cents: 0, unvaluedHours: 0 },
  };
  const entries = [
    ...planning.actualHours.map((row) => ({ ...row, destination: "chantier" as const })),
    ...planning.indirectHours.map((row) => ({ ...row, destination: row.category === "SAV" ? "sav" as const : "generalExpenses" as const })),
  ];
  let provisional = false;
  let estimatedMonthSplit = false;
  for (const row of entries) {
    if (row.hours <= 0) continue;
    const shares = monthlySharesForWeek(row.week, schedules.get(row.userId));
    const split = shares.find((item) => item.month === month);
    if (!split) continue;
    estimatedMonthSplit ||= shares.length > 1;
    const bucket = buckets[row.destination];
    const hours = row.hours * split.fraction;
    bucket.hours += hours;
    const resolved = records === null ? null : resolveLaborCostForWorkedMonth(row.userId, month, rates, now);
    if (!resolved) {
      bucket.unvaluedHours += hours;
      continue;
    }
    provisional ||= resolved.provisional;
    bucket.cents += hours * resolved.record.employerCostCents / resolved.record.workedHours;
  }
  const hours = (value: number) => Math.round(value * 100) / 100;
  function finish(bucket: typeof buckets.chantier): MonthlyConsumptionBucket {
    const cents = records !== null && bucket.unvaluedHours === 0 ? Math.round(bucket.cents) : null;
    if (cents !== null && !Number.isSafeInteger(cents)) throw new Error("MONTHLY_LABOR_COST_INVALID");
    return { hours: hours(bucket.hours), valuedCostCents: cents, unvaluedHours: hours(bucket.unvaluedHours) };
  }
  const chantier = finish(buckets.chantier);
  const sav = finish(buckets.sav);
  const generalExpenses = finish(buckets.generalExpenses);
  const totals = [chantier, sav, generalExpenses];
  return {
    month,
    chantier,
    sav,
    generalExpenses,
    total: {
      hours: hours(totals.reduce((sum, bucket) => sum + bucket.hours, 0)),
      unvaluedHours: hours(totals.reduce((sum, bucket) => sum + bucket.unvaluedHours, 0)),
      valuedCostCents: totals.some((bucket) => bucket.valuedCostCents === null) ? null : totals.reduce((sum, bucket) => sum + (bucket.valuedCostCents ?? 0), 0),
    },
    provisional,
    estimatedMonthSplit,
  };
}
