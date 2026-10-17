import { describe, expect, it } from "vitest";
import {
  assertClosedMonth,
  monthlyHourlyRateEuro,
  monthlyLaborCostInputSchema,
  parseMonthlyLaborCostsPayload,
  saveMonthlyLaborCost,
} from "../src/lib/payroll/monthly-labor-costs";
import {
  calculateChantierLaborCostCents,
  monthlySharesForWeek,
} from "../src/lib/payroll/chantier-labor-cost";
import { DEFAULT_WEEKLY_SCHEDULE } from "../src/lib/planning/capacity";

const chantierId = "11111111-1111-4111-8111-111111111111";
const personId = "22222222-2222-4222-8222-222222222222";
const ids = new Set([personId]);
const september = {
  action: "saveMonthlyLaborCost" as const,
  month: "2026-09",
  personId,
  employerCostCents: 390000,
  workedHours: 156,
};

const now = new Date("2026-11-15T12:00:00Z");

describe("monthly employer costs", () => {
  it("calculates the employer cost per hour and preserves previous months on correction", () => {
    const initial = parseMonthlyLaborCostsPayload(null);
    const first = saveMonthlyLaborCost(initial, september, ids, "Nadia", now);
    expect(monthlyHourlyRateEuro(first.records[0])).toBe(25);
    expect(initial.records).toHaveLength(0);
    const second = saveMonthlyLaborCost(
      first,
      { ...september, month: "2026-10" },
      ids,
      "Nadia",
      now,
    );
    const corrected = saveMonthlyLaborCost(
      second,
      { ...september, employerCostCents: 468000 },
      ids,
      "Lucien",
      now,
    );
    expect(corrected.records).toHaveLength(2);
    expect(corrected.records.find((r) => r.month === "2026-09")?.employerCostCents).toBe(468000);
    expect(corrected.records.find((r) => r.month === "2026-10")?.employerCostCents).toBe(390000);
    expect(corrected.records.find((r) => r.month === "2026-09")?.updatedBy).toBe("Lucien");
  });

  it("rejects current and future months as well as invalid costs or hours", () => {
    expect(() => assertClosedMonth("2026-10", new Date("2026-10-17T12:00:00Z"))).toThrow();
    expect(() => assertClosedMonth("2026-09", new Date("2026-10-17T12:00:00Z"))).not.toThrow();
    expect(() => monthlyLaborCostInputSchema.parse({ ...september, workedHours: 0 })).toThrow();
    expect(() => monthlyLaborCostInputSchema.parse({ ...september, workedHours: 6.123 })).toThrow();
    expect(() =>
      monthlyLaborCostInputSchema.parse({ ...september, employerCostCents: -100 }),
    ).toThrow();
    expect(() =>
      saveMonthlyLaborCost(parseMonthlyLaborCostsPayload(null), september, new Set(), "Nadia", now),
    ).toThrow("MONTHLY_LABOR_COST_PERSON_NOT_FOUND");
  });

  it("uses the employee's working-day share for a week crossing September and October", () => {
    const parts = monthlySharesForWeek("2026-W40", DEFAULT_WEEKLY_SCHEDULE);
    expect(parts).toHaveLength(2);
    expect(parts[0].month).toBe("2026-09");
    expect(parts[0].fraction).toBeCloseTo(0.6, 6);
    expect(parts[1].month).toBe("2026-10");
    expect(parts[1].fraction).toBeCloseTo(0.4, 6);
  });

  it("values chantier hours from monthly costs and preserves weekly quantities", () => {
    const week = [
      { chantierId, userId: personId, activity: "BE" as const, week: "2026-W40", hours: 10 },
    ];
    const original = structuredClone(week);
    const septemberCost = saveMonthlyLaborCost(
      parseMonthlyLaborCostsPayload(null),
      {
        ...september,
        employerCostCents: 312000,
        workedHours: 156,
      },
      ids,
      "Nadia",
      now,
    );
    const withOctober = saveMonthlyLaborCost(
      septemberCost,
      {
        ...september,
        month: "2026-10",
        employerCostCents: 468000,
        workedHours: 156,
      },
      ids,
      "Nadia",
      now,
    );
    expect(calculateChantierLaborCostCents(chantierId, week, septemberCost.records, [])).toBeNull();
    expect(calculateChantierLaborCostCents(chantierId, week, withOctober.records, [])).toBe(24000);
    expect(week).toEqual(original);
    expect(calculateChantierLaborCostCents(chantierId, [], withOctober.records, [])).toBe(0);
  });
});
