import { describe, expect, it } from "vitest";
import {
  applyActualHoursRow,
  applyIndirectHoursRow,
  indirectHoursRowSchema,
} from "../src/lib/planning/actual-hours";
import { createInitialPlanningPayload, parsePlanningPayload } from "../src/lib/planning/domain";
import {
  calculateIndicativeCompanyMarginCents,
  calculateIndirectLaborCostsForPeriod,
} from "../src/lib/payroll/indirect-labor-cost";

const workerId = "11111111-1111-4111-8111-111111111111";
const chantierId = "22222222-2222-4222-8222-222222222222";
const people = new Set([workerId]);
const sites = new Set([chantierId]);
const wage = (month: string, cents: number) => ({
  personId: workerId,
  month,
  employerCostCents: cents,
  workedHours: 156,
  updatedAt: "2026-11-10T10:00:00Z",
  updatedBy: "Nadia",
});
const sav = {
  action: "saveIndirectHoursRow" as const,
  userId: workerId,
  week: "2026-W39",
  category: "SAV" as const,
  hours: 6,
};

describe("SAV and overhead weekly hours without chantier", () => {
  it("keeps both categories independent, editable and entirely unrelated to chantiers", () => {
    const blank = createInitialPlanningPayload();
    const first = applyIndirectHoursRow(blank, sav, people);
    const both = applyIndirectHoursRow(first, { ...sav, category: "GENERAL", hours: 4.5 }, people);
    expect(blank.indirectHours).toEqual([]);
    expect(both.indirectHours).toEqual([
      { userId: workerId, week: "2026-W39", category: "SAV", hours: 6 },
      { userId: workerId, week: "2026-W39", category: "GENERAL", hours: 4.5 },
    ]);
    expect(both.indirectHours.every((record) => !("chantierId" in record))).toBe(true);
    expect(both.actualHours).toHaveLength(0);
    const corrected = applyIndirectHoursRow(both, { ...sav, hours: 8 }, people);
    expect(corrected.indirectHours).toHaveLength(2);
    expect(corrected.indirectHours.find((r) => r.category === "SAV")?.hours).toBe(8);
    const cleared = applyIndirectHoursRow(corrected, { ...sav, hours: 0 }, people);
    expect(cleared.indirectHours).toHaveLength(1);
    expect(parsePlanningPayload(cleared)).toEqual(cleared);
  });

  it("checks the sum of chantier, SAV, and overhead in both saving orders", () => {
    const directInput = {
      action: "saveActualHoursRow" as const,
      chantierId,
      userId: workerId,
      week: "2026-W39",
      be: 10,
      workshop: 100,
      install: 40,
    };
    const first = applyActualHoursRow(createInitialPlanningPayload(), directInput, sites, people);
    expect(() => applyIndirectHoursRow(first, { ...sav, hours: 19 }, people)).toThrow(
      "PLANNING_ACTUAL_PERSON_WEEK_TOO_HIGH",
    );
    const indirectFirst = applyIndirectHoursRow(
      createInitialPlanningPayload(),
      { ...sav, hours: 25 },
      people,
    );
    expect(() => applyActualHoursRow(indirectFirst, directInput, sites, people)).toThrow(
      "PLANNING_ACTUAL_PERSON_WEEK_TOO_HIGH",
    );
    const valid = applyIndirectHoursRow(first, { ...sav, hours: 18 }, people);
    expect(
      valid.actualHours.reduce((sum, entry) => sum + entry.hours, 0) +
        valid.indirectHours.reduce((sum, entry) => sum + entry.hours, 0),
    ).toBe(168);
  });

  it("refuses unknown people, invalid category and non-finite or negative hours", () => {
    expect(() => applyIndirectHoursRow(createInitialPlanningPayload(), sav, new Set())).toThrow(
      "PLANNING_PERSON_NOT_FOUND",
    );
    expect(() => indirectHoursRowSchema.parse({ ...sav, hours: -1 })).toThrow();
    expect(() => indirectHoursRowSchema.parse({ ...sav, hours: Infinity })).toThrow();
    expect(() => indirectHoursRowSchema.parse({ ...sav, category: "CHANTIER" })).toThrow();
    expect(() =>
      parsePlanningPayload({
        ...createInitialPlanningPayload(),
        indirectHours: [
          { userId: workerId, category: "SAV", week: "2026-W39", hours: 2 },
          { userId: workerId, category: "SAV", week: "2026-W39", hours: 3 },
        ],
      }),
    ).toThrow("PLANNING_INDIRECT_HOURS_DUPLICATE");
  });

  it("values SAV and general hours with monthly actual employer cost", () => {
    const input = [
      { userId: workerId, week: "2026-W39", category: "SAV" as const, hours: 6 },
      { userId: workerId, week: "2026-W39", category: "GENERAL" as const, hours: 4 },
    ];
    const result = calculateIndirectLaborCostsForPeriod(
      "2026-09",
      input,
      [wage("2026-09", 390000)],
      [],
    );
    expect(result).toEqual({
      savHours: 6,
      generalHours: 4,
      savCostCents: 15000,
      generalCostCents: 10000,
      totalCostCents: 25000,
    });
    expect(calculateIndicativeCompanyMarginCents(100000, result)).toBe(75000);
    expect(calculateIndicativeCompanyMarginCents(null, result)).toBeNull();
  });

  it("prorates a split-week SAV using each month's rate and keeps missing costs unpriced", () => {
    const input = [{ userId: workerId, week: "2026-W40", category: "SAV" as const, hours: 10 }];
    const onlySeptember = calculateIndirectLaborCostsForPeriod(
      "2026",
      input,
      [wage("2026-09", 390000)],
      [],
    );
    expect(onlySeptember.savHours).toBe(10);
    expect(onlySeptember.savCostCents).toBeNull();
    expect(onlySeptember.totalCostCents).toBeNull();
    expect(calculateIndicativeCompanyMarginCents(80000, onlySeptember)).toBeNull();
    const both = calculateIndirectLaborCostsForPeriod(
      "2026",
      input,
      [wage("2026-09", 390000), wage("2026-10", 468000)],
      [],
    );
    expect(both.savCostCents).toBe(27000);
    expect(both.totalCostCents).toBe(27000);
    expect(
      calculateIndirectLaborCostsForPeriod("2026-09", input, [wage("2026-09", 390000)], [])
        .savCostCents,
    ).toBe(15000);
    expect(
      calculateIndirectLaborCostsForPeriod("2026-10", input, [wage("2026-10", 468000)], [])
        .savCostCents,
    ).toBe(12000);
  });
});
