import { describe, expect, it } from "vitest";
import {
  assertClosedMonth,
  monthlyHourlyRateEuro,
  monthlyLaborCostInputSchema,
  parseMonthlyLaborCostsPayload,
  previousMonthKey,
  resolveLaborCostForWorkedMonth,
  saveMonthlyLaborCost,
} from "../src/lib/payroll/monthly-labor-costs";
import {
  calculateChantierLaborCostCents,
  calculateChantierLaborCostEstimate,
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

  it("valorise octobre en cours au coût de septembre et signale l'estimation", () => {
    const wage = {
      personId, month: "2026-09", employerCostCents: 312000, workedHours: 156,
      updatedAt: "2026-10-01T08:00:00Z", updatedBy: "Nadia",
    };
    const entries = [
      { chantierId, userId: personId, activity: "ATELIER" as const, week: "2026-W40", hours: 10 },
    ];
    const october = new Date("2026-10-31T12:00:00Z");
    const estimate = calculateChantierLaborCostEstimate(chantierId, entries, [wage], [], october);
    expect(estimate).toEqual({ costCents: 20_000, provisional: true });
    expect(calculateChantierLaborCostCents(chantierId, entries, [wage], [], october)).toBe(20_000);
    expect(resolveLaborCostForWorkedMonth(personId, "2026-10",
      new Map([[personId + ":2026-09", wage]]), october)?.provisional).toBe(true);
    expect(entries[0].hours).toBe(10);
  });

  it("ne prolonge pas l'estimation sur un mois clos sans ses coûts propres", () => {
    const wages = [{
      personId, month: "2026-09", employerCostCents: 312000, workedHours: 156,
      updatedAt: "2026-10-01T08:00:00Z", updatedBy: "Nadia",
    }];
    const entries = [
      { chantierId, userId: personId, activity: "BE" as const, week: "2026-W40", hours: 10 },
    ];
    expect(calculateChantierLaborCostEstimate(chantierId, entries, wages, [],
      new Date("2026-11-01T12:00:00Z"))).toEqual({ costCents: null, provisional: false });
    const octoberWage = { ...wages[0], month: "2026-10", employerCostCents: 468000 };
    expect(calculateChantierLaborCostEstimate(chantierId, entries,
      [...wages, octoberWage], [], new Date("2026-11-01T12:00:00Z")))
      .toEqual({ costCents: 24_000, provisional: false });
    expect(calculateChantierLaborCostEstimate(chantierId, entries,
      [...wages, octoberWage], [], new Date("2026-10-31T12:00:00Z")))
      .toEqual({ costCents: 20_000, provisional: true });
  });

  it("refuse une estimation sans paie du mois précédent et gère décembre-janvier", () => {
    expect(previousMonthKey("2027-01")).toBe("2026-12");
    expect(previousMonthKey("2026-10")).toBe("2026-09");
    const entries = [
      { chantierId, userId: personId, activity: "POSE" as const, week: "2027-W02", hours: 8 },
    ];
    const january = new Date("2027-01-15T12:00:00Z");
    expect(calculateChantierLaborCostCents(chantierId, entries, [], [], january)).toBeNull();
    const december = {
      personId, month: "2026-12", employerCostCents: 390000, workedHours: 156,
      updatedAt: "2027-01-01T08:00:00Z", updatedBy: "Nadia",
    };
    expect(calculateChantierLaborCostEstimate(chantierId, entries, [december], [], january))
      .toEqual({ costCents: 20_000, provisional: true });
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
    expect(calculateChantierLaborCostCents(chantierId, week, septemberCost.records, [], now)).toBeNull();
    expect(calculateChantierLaborCostCents(chantierId, week, withOctober.records, [], now)).toBe(24000);
    expect(week).toEqual(original);
    expect(calculateChantierLaborCostCents(chantierId, [], withOctober.records, [])).toBe(0);
  });
});
